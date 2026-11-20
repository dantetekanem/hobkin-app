/**
 * A small TLA+ run for the proof graph and math tests: two work items, a counterexample of six states that ends with
 * a merge at a head no review read, and a cut dump of the state graph around it.
 */
import type { ProofRun, ProofTraceState, TlaValue } from '#shared/protocol/proofs.ts'

const text = (value: string | number): TlaValue => (typeof value === 'number' ? { kind: 'number', text: String(value) } : value === 'None' ? { kind: 'model', text: 'None' } : { kind: 'string', text: value })
const items = (i1: string | number, i2: string | number): TlaValue => ({
  kind: 'function',
  pairs: [
    { key: 'i1', value: text(i1) },
    { key: 'i2', value: text(i2) },
  ],
})

interface Both {
  state: [string, string]
  head: [number, number]
  reviewed: [string | number, string | number]
  rate: [number, number]
}

export const varsOf = ({ state, head, reviewed, rate }: Both): ProofTraceState['vars'] => [
  { name: 'state', value: items(...state) },
  { name: 'head', value: items(...head) },
  { name: 'reviewed', value: items(...reviewed) },
  { name: 'rate', value: items(...rate) },
]

const QUEUED: Both = { state: ['queued', 'queued'], head: [0, 0], reviewed: ['None', 'None'], rate: [0, 0] }
const with_ = (base: Both, change: Partial<Both>): Both => ({ ...base, ...change })

const S1 = QUEUED
const S2 = with_(S1, { state: ['doing', 'queued'] })
const S3 = with_(S2, { state: ['branch', 'queued'], head: [1, 0] })
const S4 = with_(S3, { reviewed: [1, 'None'], rate: [9, 0] })
const S5 = with_(S4, { head: [2, 0] })
const S6 = with_(S5, { state: ['merged', 'queued'] })
/** Off the path: i2 starts first, both start, i1 pushes before any review, then two finishes. */
const A = with_(S1, { state: ['queued', 'doing'] })
const B = with_(S1, { state: ['doing', 'doing'] })
const C = with_(S3, { head: [2, 0] })
const E = with_(B, { state: ['branch', 'doing'], head: [1, 0] })
const F = with_(E, { state: ['branch', 'branch'], head: [1, 1] })

const TRACE: [string, string, Both][] = [
  ['Init', 'src/cli/work/store.mjs:546', S1],
  ['Start(i1)', 'src/cli/work/runner.mjs:88', S2],
  ['Finish(i1)', 'src/cli/work/items.mjs:142', S3],
  ['Review(i1)', 'src/cli/work/review.mjs:61', S4],
  ['Fix(i1)', 'src/cli/work/runner.mjs:203', S5],
  ['YoloMerge(i1)', 'src/cli/work/yolo-pass.mjs:165', S6],
]

export const DEFINITIONS: ProofRun['definitions'] = [
  { name: 'Init', line: 12, lines: ['Init ≜ ∧ state = [i ∈ Items ↦ "queued"]', '       ∧ head = [i ∈ Items ↦ 0]'], words: 'Every item starts queued, with no pushes and no review.' },
  { name: 'Review', line: 20, lines: ['Review(i) ≜ ∧ state[i] = "branch"', '            ∧ reviewed′ = [reviewed EXCEPT ![i] = head[i]]'], words: 'A review reads the branch at its current head and grades it.' },
  { name: 'Fix', line: 26, lines: ['Fix(i) ≜ ∧ state[i] = "branch" ∧ head[i] < MaxPush', '         ∧ head′ = [head EXCEPT ![i] = @ + 1]'], words: 'While a branch waits, an agent may push again.', code: 'src/cli/work/runner.mjs:203' },
  { name: 'YoloMerge', line: 31, lines: ['YoloMerge(i) ≜ ∧ state[i] = "branch"', '               ∧ rate[i] ≥ Rate'], words: 'YOLO merges a branch graded at the rate or higher.' },
  { name: 'Decline', line: 36, lines: ['Decline(i) ≜ ∧ state[i] = "branch"', '             ∧ state′ = [state EXCEPT ![i] = "declined"]'], words: 'A branch the user declines.' },
  { name: 'MergedAtReviewedHead', line: 44, lines: ['MergedAtReviewedHead ≜', '  ∀ i ∈ Items : state[i] = "merged" ⇒ reviewed[i] = head[i]'], words: 'Whatever merged by itself was reviewed at the exact head that merged.' },
  { name: 'Safety', line: 50, lines: ['THEOREM Safety ≜ Spec ⇒ □MergedAtReviewedHead'] },
]

/** The broken run: a counterexample and a dump of eleven of its 4,906 states. */
export function brokenRun(): ProofRun {
  const trace = TRACE.map(([action, code, both], index): ProofTraceState => ({ n: index + 1, action, code, vars: varsOf(both) }))
  const node = (id: string, both: Both, initial = false) => ({ id, initial, vars: varsOf(both) })
  return {
    id: 'run-1',
    spec: 'specs/tla/WorkItem.tla',
    tool: 'TLC 1.7.4',
    model: '2 items, up to 3 pushes each',
    workers: 4,
    started: '2026-11-20T10:00:00.000Z',
    finished: '2026-11-20T10:00:04.000Z',
    outcome: 'broken',
    steps: [
      { id: 'parse', state: 'done', note: 'SANY · no errors · 0.4 s' },
      { id: 'check', state: 'failed', note: 'TLC · counterexample at depth 6' },
      { id: 'prove', state: 'skipped', note: '' },
    ],
    stats: { generated: 12000, distinct: 4906, queue: 0, depth: 8 },
    rules: [
      { name: 'TypeOK', kind: 'invariant', status: 'holds' },
      { name: 'MergedAtReviewedHead', kind: 'invariant', status: 'broken', words: 'Whatever merged by itself was reviewed at the exact head that merged.' },
    ],
    actions: [
      { name: 'Start', count: 12408 },
      { name: 'Finish', count: 11980 },
      { name: 'Review', count: 9302 },
      { name: 'Fix', count: 7155, code: 'src/cli/work/runner.mjs:203' },
      { name: 'YoloMerge', count: 1 },
      { name: 'Decline', count: 0 },
    ],
    broken: 'MergedAtReviewedHead',
    traceLength: 6,
    samples: [],
    trace,
    graph: {
      nodes: [node('s1', S1, true), node('s2', S2), node('s3', S3), node('s4', S4), node('s5', S5), node('s6', S6), node('a', A), node('b', B), node('c', C), node('e', E), node('f', F)],
      edges: [
        { from: 's1', to: 's2', action: 'Start' },
        { from: 's2', to: 's3', action: 'Finish' },
        { from: 's3', to: 's4', action: 'Review' },
        { from: 's4', to: 's5', action: 'Fix' },
        { from: 's5', to: 's6', action: 'YoloMerge' },
        { from: 's1', to: 'a', action: 'Start' },
        { from: 's2', to: 'b', action: 'Start' },
        { from: 'a', to: 'b', action: 'Start' },
        { from: 's3', to: 'c', action: 'Fix' },
        { from: 'b', to: 'e', action: 'Finish' },
        { from: 'e', to: 'f', action: 'Finish' },
      ],
      total: 4906,
    },
    definitions: DEFINITIONS,
    log: [],
  }
}

/** The same run as an older dump-less one: only the counterexample. */
export function traceOnlyRun(): ProofRun {
  const { graph: _graph, ...run } = brokenRun()
  return run
}

/** A model that holds: a graph and no trace. */
export function holdingRun(): ProofRun {
  const { trace: _trace, broken: _broken, traceLength: _length, ...run } = brokenRun()
  return { ...run, outcome: 'holds', rules: run.rules.map((rule) => ({ ...rule, status: 'holds' })) }
}
