import type { ProofDefinition, ProofGraph, ProofLogLine, ProofObligation, ProofOutcome, ProofRule, ProofRun, ProofRunSummary, ProofsState, ProofStep, ProofTraceState, TlaValue } from '#shared/protocol/proofs.ts'

/**
 * A TLA+ proof run for a window with no host and for still renders (_specs/050-tla-proofs), in the shape `proof.get`
 * answers (`shared/protocol/proofs.ts`). It is the design's example: a model of how a work item moves from queued to
 * merged, `specs/tla/WorkItem.tla`, whose check finds that YOLO mode merges a head no review read. Nothing here came
 * from hobkin.
 *
 * The runs are the phases of that check: `checking` while TLC runs, `broken` once it found the counterexample, `holds`
 * after the fix, `proved` once TLAPS proved the fixed spec for every size, and `proofFails` when the proof of the
 * unfixed spec was asked for and fails at the case TLC broke.
 */

export type SamplePhase = 'checking' | 'broken' | 'holds' | 'proved' | 'proofFails'

export const SAMPLE_PHASES: readonly SamplePhase[] = ['checking', 'broken', 'holds', 'proved', 'proofFails']

/** When the sample's check started: 14:05 today, on this Mac's clock. */
export const SAMPLE_STARTED = (() => {
  const day = new Date()
  day.setHours(14, 5, 0, 0)
  return day.getTime()
})()

/** How long each sample had run when it is shown: a check under way is 41 seconds in. */
export const SAMPLE_ELAPSED_MS: Readonly<Record<SamplePhase, number>> = { checking: 41_000, broken: 9_000, holds: 157_000, proved: 181_000, proofFails: 26_000 }

// The model's values, as the window draws them.

const text = (value: string): TlaValue => ({ kind: 'string', text: value })
const number = (value: number): TlaValue => ({ kind: 'number', text: String(value) })
const NONE: TlaValue = { kind: 'model', text: 'None' }
const ITEMS = ['i1', 'i2'] as const

/** One item's part of a state. */
interface Item {
  state: 'queued' | 'doing' | 'branch' | 'merged' | 'declined'
  head: number
  reviewed: number | null
  rate: number
}

type World = readonly [Item, Item]

const perItem = (world: World, value: (item: Item) => TlaValue): TlaValue => ({ kind: 'function', pairs: ITEMS.map((key, index) => ({ key, value: value(world[index]!) })) })

/** A state's variables, in the order the spec declares them. */
const varsOf = (world: World): ProofTraceState['vars'] => [
  { name: 'state', value: perItem(world, (item) => text(item.state)) },
  { name: 'head', value: perItem(world, (item) => number(item.head)) },
  { name: 'reviewed', value: perItem(world, (item) => (item.reviewed === null ? NONE : number(item.reviewed))) },
  { name: 'rate', value: perItem(world, (item) => number(item.rate)) },
]

const QUEUED: Item = { state: 'queued', head: 0, reviewed: null, rate: 0 }
const INIT: World = [QUEUED, QUEUED]
const MAX_PUSH = 3
const RATE = 8

/**
 * The spec's next-state relation for two items, small enough to walk here. Before the fix YoloMerge never asks which
 * head its grade was for. Reviews before the fix always grade a 9, so Decline, which needs a grade under the rate,
 * never fires: the coverage the broken run reports.
 */
function movesOf(world: World, fixed: boolean): { action: string; to: World }[] {
  const moves: { action: string; to: World }[] = []
  world.forEach((item, index) => {
    const name = ITEMS[index]!
    const put = (action: string, changed: Partial<Item>) => {
      const moved = { ...item, ...changed }
      const to: World = index === 0 ? [moved, world[1]] : [world[0], moved]
      moves.push({ action: `${action}(${name})`, to })
    }
    if (item.state === 'queued') put('Start', { state: 'doing' })
    if (item.state === 'doing') put('Finish', { state: 'branch', head: item.head + 1 })
    if (item.state !== 'branch') return
    if (item.reviewed !== item.head) for (const rate of fixed ? [5, 9] : [9]) put('Review', { reviewed: item.head, rate })
    if (item.head < MAX_PUSH) put('Fix', { head: item.head + 1 })
    if (item.rate >= RATE && (!fixed || item.reviewed === item.head)) put('YoloMerge', { state: 'merged' })
    if (item.reviewed === item.head && item.rate < RATE) put('Decline', { state: 'declined' })
  })
  return moves
}

const keyOf = (world: World) => JSON.stringify(world)

/**
 * The state graph as TLC's dump draws it: every state within five steps of the start, breadth first, cut to about
 * forty so the views have a graph to lay out. The states of the counterexample are always kept.
 */
function graphOf(fixed: boolean, keep: readonly World[], total: number): ProofGraph {
  const seen = new Map<string, { world: World; depth: number }>([[keyOf(INIT), { world: INIT, depth: 0 }]])
  const edges: { from: string; to: string; action: string }[] = []
  let frontier: World[] = [INIT]
  for (let depth = 1; depth <= 5; depth++) {
    const next: World[] = []
    for (const world of frontier) {
      for (const move of movesOf(world, fixed)) {
        const key = keyOf(move.to)
        edges.push({ from: keyOf(world), to: key, action: move.action })
        if (seen.has(key)) continue
        seen.set(key, { world: move.to, depth })
        next.push(move.to)
      }
    }
    frontier = next
  }
  const kept = new Set(keep.map(keyOf))
  const ordered = [...seen.keys()]
  for (const key of ordered) if (kept.size < 42) kept.add(key)
  const ids = new Map(ordered.filter((key) => kept.has(key)).map((key, index) => [key, `s${index + 1}`]))
  return {
    nodes: [...ids].map(([key, id]) => ({ id, initial: key === keyOf(INIT), vars: varsOf(seen.get(key)!.world) })),
    edges: edges.filter(({ from, to }) => from !== to && ids.has(from) && ids.has(to)).map(({ from, to, action }) => ({ from: ids.get(from)!, to: ids.get(to)!, action })),
    total,
  }
}

const step = (world: World, change: Partial<Item>): World => [{ ...world[0], ...change }, world[1]]
const STARTED = step(INIT, { state: 'doing' })
const FINISHED = step(STARTED, { state: 'branch', head: 1 })
const REVIEWED = step(FINISHED, { reviewed: 1, rate: 9 })
const FIXED = step(REVIEWED, { head: 2 })
const MERGED = step(FIXED, { state: 'merged' })
const PATH: readonly World[] = [INIT, STARTED, FINISHED, REVIEWED, FIXED, MERGED]

/** The counterexample: a fix pushed after the review, merged on the old grade. Each action names its code. */
const TRACE: ProofTraceState[] = [
  { n: 1, action: 'Init', code: 'src/cli/work/store.mjs:546', vars: varsOf(INIT) },
  { n: 2, action: 'Start(i1)', code: 'src/cli/work/runner.mjs:88', vars: varsOf(STARTED) },
  { n: 3, action: 'Finish(i1)', code: 'src/cli/work/items.mjs:142', vars: varsOf(FINISHED) },
  { n: 4, action: 'Review(i1)', code: 'src/cli/work/review.mjs:61', vars: varsOf(REVIEWED) },
  { n: 5, action: 'Fix(i1)', code: 'src/cli/work/runner.mjs:203', vars: varsOf(FIXED) },
  { n: 6, action: 'YoloMerge(i1)', code: 'src/cli/work/yolo-pass.mjs:165', vars: varsOf(MERGED) },
]

// The spec, as the math view sets it.

type Written = Omit<ProofDefinition, 'line'>

function written(fixed: boolean, proof: boolean): ProofDefinition[] {
  const merge = ['YoloMerge(i) ≜ ∧ state[i] = "branch"', '               ∧ rate[i] ≥ Rate', ...(fixed ? ['               ∧ reviewed[i] = head[i]'] : []), '               ∧ state′ = [state EXCEPT ![i] = "merged"]', '               ∧ UNCHANGED ⟨head, reviewed, rate⟩']
  const blocks: Written[] = [
    { name: 'WorkItem', lines: ['──── MODULE WorkItem ────', 'EXTENDS Naturals', 'CONSTANTS Items, MaxPush, Rate, None', 'VARIABLES state, head, reviewed, rate'], words: 'A model of how work items move from queued to merged, for any set of items.' },
    {
      name: 'TypeOK',
      lines: ['TypeOK ≜ ∧ state ∈ [Items → {"queued", "doing", "branch", "merged", "declined"}]', '         ∧ head ∈ [Items → 0‥MaxPush]', '         ∧ reviewed ∈ [Items → 0‥MaxPush ∪ {None}]', '         ∧ rate ∈ [Items → 0‥10]'],
      words: 'Each item is in one of five states. Heads count pushes, and a review remembers which head it read.',
    },
    { name: 'Init', lines: ['Init ≜ ∧ state = [i ∈ Items ↦ "queued"]', '       ∧ head = [i ∈ Items ↦ 0]', '       ∧ reviewed = [i ∈ Items ↦ None]', '       ∧ rate = [i ∈ Items ↦ 0]'], words: 'Every item starts queued, with no pushes and no review.', code: 'src/cli/work/store.mjs:546' },
    { name: 'Start', lines: ['Start(i) ≜ ∧ state[i] = "queued"', '           ∧ state′ = [state EXCEPT ![i] = "doing"]', '           ∧ UNCHANGED ⟨head, reviewed, rate⟩'], words: 'Work mode picks a queued item, and an agent starts on it.', code: 'src/cli/work/runner.mjs:88' },
    {
      name: 'Finish',
      lines: ['Finish(i) ≜ ∧ state[i] = "doing"', '            ∧ state′ = [state EXCEPT ![i] = "branch"]', '            ∧ head′ = [head EXCEPT ![i] = @ + 1]', '            ∧ UNCHANGED ⟨reviewed, rate⟩'],
      words: 'The agent finishes and pushes its branch. The head counts that push.',
      code: 'src/cli/work/items.mjs:142',
    },
    {
      name: 'Review',
      lines: ['Review(i) ≜ ∧ state[i] = "branch"', '            ∧ reviewed′ = [reviewed EXCEPT ![i] = head[i]]', '            ∧ ∃ r ∈ 1‥10 : rate′ = [rate EXCEPT ![i] = r]', '            ∧ UNCHANGED ⟨state, head⟩'],
      words: 'A review reads the branch at its current head and grades it from 1 to 10.',
      code: 'src/cli/work/review.mjs:61',
    },
    {
      name: 'Fix',
      lines: ['Fix(i) ≜ ∧ state[i] = "branch" ∧ head[i] < MaxPush', '         ∧ head′ = [head EXCEPT ![i] = @ + 1]', '         ∧ UNCHANGED ⟨state, reviewed, rate⟩'],
      words: 'While a branch waits, an agent may push again. The head moves; the review does not.',
      code: 'src/cli/work/runner.mjs:203',
    },
    {
      name: 'YoloMerge',
      lines: merge,
      words: fixed ? 'YOLO merges a branch graded at the rate or higher, and only when its review read this very head.' : 'YOLO merges a branch graded at the rate or higher. It never asks which head that grade was for.',
      code: 'src/cli/work/yolo-pass.mjs:165',
    },
    {
      name: 'Decline',
      lines: ['Decline(i) ≜ ∧ state[i] = "branch"', '             ∧ reviewed[i] = head[i] ∧ rate[i] < Rate', '             ∧ state′ = [state EXCEPT ![i] = "declined"]', '             ∧ UNCHANGED ⟨head, reviewed, rate⟩'],
      words: 'A branch its review graded under the rate is declined, and waits for the user.',
      code: 'src/cli/work/items.mjs:171',
    },
    {
      name: 'Next',
      lines: ['Next ≜ ∃ i ∈ Items : Start(i) ∨ Finish(i) ∨ Review(i)', '                     ∨ Fix(i) ∨ YoloMerge(i) ∨ Decline(i)', 'Spec ≜ Init ∧ □[Next]_vars ∧ WF_vars(Next)'],
      words: 'At each step, one item takes one of these actions. Something always happens in the end.',
    },
    { name: 'MergedAtReviewedHead', lines: ['MergedAtReviewedHead ≜', '  ∀ i ∈ Items : state[i] = "merged" ⇒ reviewed[i] = head[i]'], words: 'Nothing merges by itself past the head its review saw.' },
    { name: 'NoMergeBelowRate', lines: ['NoMergeBelowRate ≜', '  ∀ i ∈ Items : state[i] = "merged" ⇒ rate[i] ≥ Rate'], words: 'A merge by itself needs the chosen rate or higher.' },
    { name: 'EveryItemEnds', lines: ['EveryItemEnds ≜', '  ∀ i ∈ Items : state[i] = "branch" ⇝ state[i] ∈ {"merged", "declined"}'], words: 'Every finished item is merged or declined in the end.' },
    ...(proof
      ? [
          { name: 'Inv', lines: ['Inv ≜ TypeOK ∧ MergedAtReviewedHead'], words: 'The types hold, and nothing merged past the head its review read.' },
          { name: 'Safety', lines: ['THEOREM Safety ≜ Spec ⇒ □MergedAtReviewedHead'], words: 'In every behavior the spec allows, at every step, nothing merged past the head its review read.' },
        ]
      : []),
  ]
  // Each block starts where the one before it ended, a blank line between.
  let line = 1
  return blocks.map((block) => {
    const placed = { ...block, line }
    line += block.lines.length + 1
    return placed
  })
}

/** The TLAPS proof, depth first: three level-one steps, the six cases of Next, and the steps inside them. */
function obligationsOf(fixed: boolean): ProofObligation[] {
  const proved = (id: string, label: string, depth: number, backend?: string, seconds?: number): ProofObligation => ({ id, label, status: 'proved', depth, ...(backend ? { backend } : {}), ...(seconds === undefined ? {} : { seconds }) })
  const merge = fixed
    ? proved('<2>5', 'CASE YoloMerge(i)', 2, 'SMT', 0.7)
    : { id: '<2>5', label: 'CASE YoloMerge(i)', status: 'failed' as const, depth: 2, backend: 'SMT', seconds: 2.1, goal: 'reviewed′[i] = head′[i]', known: ['state[i] = "branch"', 'rate[i] ≥ Rate', 'head′ = head ∧ reviewed′ = reviewed'] }
  return [
    proved('<1>1', 'Init ⇒ Inv', 1, 'Zenon', 0.3),
    fixed ? proved('<1>2', 'Inv ∧ [Next]_vars ⇒ Inv′', 1) : { id: '<1>2', label: 'Inv ∧ [Next]_vars ⇒ Inv′', status: 'pending', depth: 1 },
    proved('<2>1', 'CASE Start(i)', 2, 'SMT', 0.4),
    proved('<2>2', 'CASE Finish(i)', 2, 'SMT', 0.5),
    proved('<3>1', 'head′[i] ∈ 0‥MaxPush', 3, 'SMT', 0.2),
    proved('<2>3', 'CASE Review(i)', 2, 'SMT', 0.6),
    proved('<3>1', 'reviewed′[i] = head[i]', 3, 'SMT', 0.2),
    proved('<3>2', 'rate′[i] ∈ 1‥10', 3, 'Zenon', 0.1),
    proved('<2>4', 'CASE Fix(i)', 2, 'SMT', 1.1),
    proved('<3>1', 'state[i] = "branch" ⇒ state′[i] ≠ "merged"', 3, 'SMT', 0.3),
    proved('<3>2', 'UNCHANGED reviewed', 3, 'Zenon', 0.1),
    merge,
    proved('<3>1', 'state′[i] = "merged"', 3, 'SMT', 0.2),
    proved('<3>2', 'head′ = head ∧ reviewed′ = reviewed', 3, 'Zenon', 0.1),
    proved('<3>3', 'rate′[i] ≥ Rate', 3, 'SMT', 0.3),
    proved('<2>6', 'CASE Decline(i)', 2, 'Zenon', 0.2),
    fixed ? proved('<1>3', 'QED', 1, 'PTL', 0.9) : { id: '<1>3', label: 'QED', status: 'pending', depth: 1 },
  ]
}

// The run's own record.

const ACTION_CODE: Readonly<Record<string, string>> = {
  Start: 'src/cli/work/runner.mjs:88',
  Finish: 'src/cli/work/items.mjs:142',
  Review: 'src/cli/work/review.mjs:61',
  Fix: 'src/cli/work/runner.mjs:203',
  YoloMerge: 'src/cli/work/yolo-pass.mjs:165',
  Decline: 'src/cli/work/items.mjs:171',
}

const actionsOf = (counts: readonly number[]) => Object.entries(ACTION_CODE).map(([name, code], index) => ({ name, count: counts[index] ?? 0, code }))

const RULES: readonly Omit<ProofRule, 'status'>[] = [
  { name: 'TypeOK', kind: 'invariant', words: 'Every variable keeps its type' },
  { name: 'MergedAtReviewedHead', kind: 'invariant', words: 'Nothing merges by itself past the head its review saw' },
  { name: 'NoMergeBelowRate', kind: 'invariant', words: 'A merge by itself needs the chosen rate or higher' },
  { name: 'EveryItemEnds', kind: 'property', words: 'Every finished item is merged or declined in the end' },
]

const rulesOf = (statuses: readonly ProofRule['status'][]): ProofRule[] => RULES.map((rule, index) => ({ ...rule, status: statuses[index] ?? 'unchecked' }))

/** Distinct states over the run, from the shape of a curve in hundredths of its end. */
const samplesOf = (curve: readonly number[], total: number, ms: number) => curve.map((share, index) => ({ at: Math.round((index / (curve.length - 1)) * ms), distinct: Math.round((share / curve.at(-1)!) * total) }))

const RISING = [0, 4, 11, 21, 33, 46, 58, 68, 76, 82, 86, 89]
const EARLY = [0, 6, 17, 29, 38]
const WHOLE = [0, 4, 11, 21, 33, 46, 58, 68, 76, 82, 86, 89, 92, 94, 96, 97, 98, 99, 100, 100]

const PARSED: ProofStep = { id: 'parse', state: 'done', note: 'SANY · no errors · 0.4 s' }

interface Phase {
  outcome: ProofOutcome
  head: string
  steps: ProofStep[]
  stats: ProofRun['stats']
  counts: number[]
  rules: ProofRule['status'][]
  curve: readonly number[]
  fixed: boolean
  proof: boolean
  log: [minute: number, text: string, detail: string, tone: ProofLogLine['tone']][]
}

const READ: Phase['log'] = [
  [-3, 'Read how an item moves from queued to merged', 'src/cli/work/items.mjs · yolo-pass.mjs', 'done'],
  [-1, 'Wrote the model: 6 actions, 4 things that must stay true', 'specs/tla/WorkItem.tla', 'done'],
  [-1, 'Parsed it with SANY', 'no errors', 'done'],
]
const BROKE: Phase['log'][number] = [0, 'Found a counterexample: a merge on a stale grade', '5 steps · MergedAtReviewedHead', 'bad']

const PHASES: Readonly<Record<SamplePhase, Phase>> = {
  checking: {
    outcome: 'checking',
    head: '9b04e1d',
    steps: [PARSED, { id: 'check', state: 'running', note: 'TLC · breadth first · 8 workers' }, { id: 'prove', state: 'waiting', note: 'Optional · after the model holds' }],
    stats: { generated: 61_950, distinct: 12_408, queue: 3_112, depth: 14 },
    counts: [12_408, 11_980, 9_302, 7_155, 2_210, 0],
    rules: ['holding', 'holding', 'holding', 'unchecked'],
    curve: RISING,
    fixed: false,
    proof: false,
    log: [...READ, [0, 'Checking every state 2 items can reach', 'tlc -workers 8 · breadth first', 'running']],
  },
  broken: {
    outcome: 'broken',
    head: '9b04e1d',
    steps: [PARSED, { id: 'check', state: 'failed', note: 'TLC · counterexample at depth 5' }, { id: 'prove', state: 'skipped', note: 'Waits until the model holds' }],
    stats: { generated: 21_477, distinct: 4_906, queue: 1_940, depth: 5 },
    counts: [4_906, 4_511, 2_967, 1_830, 312, 0],
    rules: ['holding', 'broken', 'unchecked', 'unchecked'],
    curve: EARLY,
    fixed: false,
    proof: false,
    log: [...READ, [0, 'Checking every state 2 items can reach', 'tlc -workers 8 · breadth first', 'done'], BROKE, [1, 'Fixing the merge check to compare heads', 'src/cli/work/yolo-pass.mjs:171', 'running']],
  },
  holds: {
    outcome: 'holds',
    head: '3f1a9c2',
    steps: [PARSED, { id: 'check', state: 'done', note: 'TLC · 48,211 states · no errors' }, { id: 'prove', state: 'waiting', note: 'TLAPS · ready to prove for any size' }],
    stats: { generated: 236_804, distinct: 48_211, queue: 0, depth: 19 },
    counts: [48_211, 46_990, 40_118, 31_872, 9_204, 3_318],
    rules: ['holds', 'holds', 'holds', 'holds'],
    curve: WHOLE,
    fixed: true,
    proof: false,
    log: [...READ, BROKE, [1, 'Fixed the merge check to compare heads', 'yolo-pass.mjs:171 · 3f1a9c2', 'done'], [3, 'Checked again at the new head: it holds', '48,211 states · 2:37', 'ok']],
  },
  proved: {
    outcome: 'holds',
    head: '3f1a9c2',
    steps: [PARSED, { id: 'check', state: 'done', note: 'TLC · 48,211 states · no errors' }, { id: 'prove', state: 'done', note: 'TLAPS · 17 of 17 proved · strict' }],
    stats: { generated: 236_804, distinct: 48_211, queue: 0, depth: 19 },
    counts: [48_211, 46_990, 40_118, 31_872, 9_204, 3_318],
    rules: ['holds', 'holds', 'holds', 'holds'],
    curve: WHOLE,
    fixed: true,
    proof: true,
    log: [...READ, [3, 'Checked again at the new head: it holds', '48,211 states · 2:37', 'ok'], [3, 'Proved it for every size with TLAPS', '17 of 17 steps · --strict', 'ok']],
  },
  proofFails: {
    outcome: 'broken',
    head: '9b04e1d',
    steps: [PARSED, { id: 'check', state: 'failed', note: 'TLC · counterexample at depth 5' }, { id: 'prove', state: 'failed', note: 'TLAPS · ⟨2⟩5 fails' }],
    stats: { generated: 21_477, distinct: 4_906, queue: 1_940, depth: 5 },
    counts: [4_906, 4_511, 2_967, 1_830, 312, 0],
    rules: ['holding', 'broken', 'unchecked', 'unchecked'],
    curve: EARLY,
    fixed: false,
    proof: true,
    log: [...READ, BROKE, [0, 'Tried the proof for every size with TLAPS', '⟨2⟩5 CASE YoloMerge(i) fails', 'bad'], [1, 'Fixing the merge check to compare heads', 'src/cli/work/yolo-pass.mjs:171', 'running']],
  },
}

const iso = (ms: number) => new Date(ms).toISOString()

/** One phase of the sample check, started at `started` (ms). */
export function sampleRun(phase: SamplePhase, started = SAMPLE_STARTED): ProofRun {
  const shape = PHASES[phase]
  const elapsed = SAMPLE_ELAPSED_MS[phase]
  const broken = shape.outcome === 'broken'
  const checking = shape.outcome === 'checking'
  const holds = shape.outcome === 'holds'
  return {
    id: `sample-${phase}`,
    project: 'hobkin',
    item: '4f2c',
    spec: 'specs/tla/WorkItem.tla',
    head: shape.head,
    tool: 'TLC 1.7.4',
    model: '2 items, up to 3 pushes each, rate 8',
    workers: 8,
    started: iso(started),
    ...(checking ? { rate: 18_200 } : { finished: iso(started + elapsed) }),
    outcome: shape.outcome,
    steps: shape.steps,
    stats: shape.stats,
    rules: rulesOf(shape.rules),
    actions: actionsOf(shape.counts),
    ...(broken ? { broken: 'MergedAtReviewedHead', traceLength: TRACE.length, trace: TRACE } : {}),
    // TLC dumps its graph when the check ends, so a check under way has none yet.
    ...(checking ? {} : { graph: graphOf(shape.fixed, broken ? PATH : [], shape.stats.distinct) }),
    counts: holds,
    samples: samplesOf(shape.curve, shape.stats.distinct, elapsed),
    definitions: written(shape.fixed, shape.proof),
    ...(shape.proof ? { proof: { strict: true, obligations: obligationsOf(shape.fixed) } } : {}),
    log: shape.log.map(([minute, line, detail, tone]) => ({ at: iso(started + minute * 60_000), text: line, detail, tone })),
  }
}

/** Every phase, started at 14:05 today. */
export const SAMPLE_RUNS: Readonly<Record<SamplePhase, ProofRun>> = Object.fromEntries(SAMPLE_PHASES.map((phase) => [phase, sampleRun(phase)])) as Record<SamplePhase, ProofRun>

/** The full example: the broken check, with its counterexample, its state graph and its spec. */
export const SAMPLE_RUN: ProofRun = SAMPLE_RUNS.broken

/** What the `proofs` slice carries of a run: everything but its chart, trace, graph, spec, proof and log. */
export function sampleSummary(run: ProofRun): ProofRunSummary {
  const { samples: _samples, trace: _trace, graph: _graph, definitions: _definitions, proof: _proof, log: _log, ...summary } = run
  return summary
}

/** The `proofs` slice with no host: every sample run, newest first, and tools found except TLAPS. */
export const SAMPLE_PROOFS: ProofsState = {
  runs: [SAMPLE_RUNS.proved, SAMPLE_RUNS.holds, SAMPLE_RUNS.proofFails, SAMPLE_RUNS.broken, SAMPLE_RUNS.checking].map(sampleSummary),
  tools: { java: '21.0.5', tlc: '1.7.4', tlaps: null },
}
