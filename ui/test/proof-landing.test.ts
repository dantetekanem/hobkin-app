import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import type { ProofRunSummary } from '#shared/protocol/proofs.ts'
import type { ModelFact } from '#shared/protocol/work.ts'
import { useView } from '../src/app/view-store.ts'
import { land } from '../src/features/proofs/failures.ts'
import { FRESH, keptOf, useProofMemory } from '../src/features/proofs/kept.ts'
import { chipsOf, factChips } from '../src/features/proofs/proof-match.ts'
import { evidenceLine } from '../src/features/proofs/run/run-view.ts'
import { sampleRun, sampleSummary, type SamplePhase } from '../src/features/proofs/sample.ts'
import { chipRuns } from '../src/features/proofs/siblings.ts'

// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
const { openRunAmong } = await import('../src/features/proofs/open-run.ts')

const STARTED = Date.parse('2026-11-20T14:05:00Z')
const summary = (phase: SamplePhase, change: Partial<ProofRunSummary> = {}): ProofRunSummary => ({ ...sampleSummary(sampleRun(phase, STARTED)), ...change })

test('"Proof fails" opens its run at the proof, a broken model at its break, and a chip that holds on what it was left at', () => {
  const run = summary('proofFails', { id: 'fails' })
  const chips = chipsOf([run])
  assert.deepEqual(chips.map(({ label, lands }) => [label, lands]), [['Model broke · 5 steps', 'break'], ['Proof fails', 'proof']])
  assert.equal(chipsOf([summary('holds')])[0]!.lands, undefined)

  const facts: ModelFact[] = [{ spec: run.spec, state: 'broken', run: 'fails' } as ModelFact]
  assert.deepEqual(factChips(facts, [run]).map(({ lands }) => lands), ['break', 'proof'])

  useProofMemory.setState({ runs: {}, siblings: [] })
  useView.setState({ screen: 'work', openProof: null })
  const proofChip = chips[1]!
  openRunAmong(proofChip.id!, chipRuns(chips), proofChip.lands)
  assert.deepEqual([useView.getState().screen, useView.getState().openProof], ['proof', 'fails'])
  assert.deepEqual([keptOf('fails').tab, keptOf('fails').landing], ['math', 'proof'], 'it opens on the math, and lands once the run is whole')

  openRunAmong('fails', ['fails'], 'break')
  assert.deepEqual([keptOf('fails').tab, keptOf('fails').landing], ['graph', 'break'])
  openRunAmong('fails', ['fails'])
  assert.deepEqual([keptOf('fails').tab, keptOf('fails').landing], ['graph', 'break'], 'opened with no place to land, it shows what it was left at')
})

test('a run opened at its proof lands on the first step that failed once the run is whole, and at its break on the trace', () => {
  const run = sampleRun('proofFails', STARTED)
  const proof = land(run, { ...FRESH, tab: 'math', landing: 'proof' })
  assert.deepEqual([proof.tab, proof.math.step, proof.math.block, proof.failure, proof.landing], ['math', 11, 'YoloMerge', 1, null])

  const trace = land(run, { ...FRESH, tab: 'graph', landing: 'break' })
  assert.deepEqual([trace.tab, trace.graph.picked, trace.failure, trace.landing], ['graph', null, 0, null])

  // A run with nothing of the kind to land on lands nowhere, and forgets it.
  const proved = land(sampleRun('proved', STARTED), { ...FRESH, tab: 'math', landing: 'proof' })
  assert.deepEqual([proved.tab, proved.math.step, proved.landing], ['math', null, null])
  const none = { ...FRESH }
  assert.equal(land(run, none), none, 'no landing, nothing changes')
})

test('a run that does not count as evidence says so in plain words, and one that counts or an older host says nothing', () => {
  assert.equal(evidenceLine(sampleRun('broken', STARTED)), 'Not evidence that it holds: a rule broke')
  assert.equal(evidenceLine(sampleRun('checking', STARTED)), 'Not evidence yet: it is still checking')
  assert.equal(evidenceLine({ ...sampleRun('holds', STARTED), counts: false, actions: [{ name: 'Decline', count: 0 }] }), 'Not evidence: Decline never ran')
  assert.equal(evidenceLine({ ...sampleRun('holds', STARTED), counts: false }), 'Not evidence for this change: it checked another commit or another copy of the spec')
  assert.equal(evidenceLine({ ...sampleRun('broken', STARTED), outcome: 'stopped', counts: false }), 'Not evidence: it was stopped before the end')
  assert.equal(evidenceLine({ ...sampleRun('broken', STARTED), outcome: 'error', counts: false }), 'Not evidence: the check could not run')
  assert.equal(evidenceLine(sampleRun('proved', STARTED)), null)
  const { counts: _counts, ...older } = sampleRun('broken', STARTED)
  assert.equal(evidenceLine(older), null)
})
