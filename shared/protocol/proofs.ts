/**
 * TLA+ proof runs as the window draws them (_specs/050-tla-proofs). hobkin's `hobkin proof check` writes each run under
 * `<home>/proofs/<id>/`: `events.jsonl` while it runs and `result.json` when it ends. The host reads those files and
 * sends a summary of each run in the `proofs` slice, and the whole run through `proof.get`. Every field a newer runtime
 * adds is optional, so an older host or window still works.
 */

/** Where a run stands. `checking` while any step runs; the rest are how it ended. */
export type ProofOutcome = 'checking' | 'holds' | 'broken' | 'error' | 'stopped'

/** The three steps of a run, in order: SANY parses, TLC model checks, TLAPS proves (only when the spec has a proof). */
export type ProofStepId = 'parse' | 'check' | 'prove'

export type ProofStepState = 'waiting' | 'running' | 'done' | 'failed' | 'skipped'

export interface ProofStep {
  id: ProofStepId
  state: ProofStepState
  /** One short line: "SANY · no errors · 0.4 s", "TLC · counterexample at depth 5". */
  note: string
}

/** TLC's counts, from its progress message (2200) and final stats (2199). */
export interface ProofStats {
  generated: number
  distinct: number
  /** States still waiting to be explored. 0 once TLC has explored them all. */
  queue: number
  /** The longest path from an initial state TLC has seen. */
  depth: number
}

/** One thing the model must keep true: an invariant, a temporal property, or freedom from deadlock. */
export interface ProofRule {
  name: string
  kind: 'invariant' | 'property' | 'deadlock'
  /**
   * `holding` while TLC is still checking and has not seen it break, `holds` once the run ended with it intact,
   * `broken` when TLC found a counterexample, `unchecked` when the run ended before reaching it (temporal properties
   * are checked at the end).
   */
  status: 'holding' | 'holds' | 'broken' | 'unchecked'
  /** The spec's `\* words:` gloss for it, when it has one. */
  words?: string
}

/** One action of the spec's next-state relation, with how many times it fired (TLC's coverage). */
export interface ProofAction {
  name: string
  /** Distinct states it produced. 0 means it never fired, so nothing it guards was checked. */
  count: number
  /** The spec's `\* code: path:line` for it. */
  code?: string
}

/** A TLA+ value, as TLC printed it, in a shape the window can draw without parsing TLA+. */
export type TlaValue =
  | { kind: 'string' | 'number' | 'boolean' | 'model'; text: string }
  | { kind: 'set' | 'sequence'; items: TlaValue[] }
  | { kind: 'function' | 'record'; pairs: { key: string; value: TlaValue }[] }
  | { kind: 'raw'; text: string }

/** One state of a counterexample, in order from the initial state. */
export interface ProofTraceState {
  /** 1 for the initial state. */
  n: number
  /** The action that led here: `Init` for the first, else the action's name with its arguments, such as `Fix(i1)`. */
  action: string
  code?: string
  vars: { name: string; value: TlaValue }[]
}

/** The state graph from TLC's dot dump, when the model was small enough to dump (at most 50,000 distinct states). */
export interface ProofGraph {
  nodes: { id: string; initial: boolean; vars: { name: string; value: TlaValue }[] }[]
  edges: { from: string; to: string; action: string }[]
  /** Distinct states in the whole model, which can be more than `nodes` when the dump was cut. */
  total: number
}

/** One step of a TLAPS proof, from `tlapm --toolbox`. */
export interface ProofObligation {
  /** The step's label as written, such as `<2>5`. */
  id: string
  /** What it proves, typeset: "CASE YoloMerge(i)". */
  label: string
  status: 'proved' | 'failed' | 'omitted' | 'missing' | 'pending'
  /** Nesting depth: 1 for `<1>` steps. */
  depth: number
  backend?: string
  seconds?: number
  /** For a failed step: what it had to show, and what it knew. */
  goal?: string
  known?: string[]
}

/** One top-level definition of the spec, for the math view. */
export interface ProofDefinition {
  name: string
  /** The definition's lines in Unicode TLA+, as written (hobkin converts ASCII with tlauc's symbol table). */
  lines: string[]
  /** 1-based line in the spec file where it starts. */
  line: number
  words?: string
  code?: string
}

/** One line of what the run did, for "What hobkin is doing". */
export interface ProofLogLine {
  at: string
  text: string
  detail?: string
  tone: 'done' | 'running' | 'ok' | 'bad'
}

/** A run as the `proofs` slice carries it: enough for a card, a chip and the live counters. */
export interface ProofRunSummary {
  id: string
  /** The work mode project and item it belongs to, when an agent ran it for one. */
  project?: string
  item?: string
  /** The spec's path in the project, such as `specs/tla/WorkItem.tla`. */
  spec: string
  /** The commit it checked. */
  head?: string
  /** "TLC 1.7.4" */
  tool: string
  /** The model's size in one line: "2 items, up to 3 pushes each". From the cfg's constants. */
  model?: string
  workers: number
  /** ISO times. */
  started: string
  finished?: string
  outcome: ProofOutcome
  steps: ProofStep[]
  stats: ProofStats
  /** New distinct states a second, while checking. */
  rate?: number
  rules: ProofRule[]
  actions: ProofAction[]
  /** The rule that broke, when one did. */
  broken?: string
  /** States in the counterexample, when there is one. */
  traceLength?: number
  /** Why it ended in `error`, in a line. */
  message?: string
  /** Whether hobkin counts it as evidence for its item: it ended `holds`, every action fired, and its head and spec hash match. */
  counts?: boolean
}

/** A whole run, from `proof.get`. */
export interface ProofRun extends ProofRunSummary {
  /** Distinct states over time, for the chart: ms since start and the count then. */
  samples: { at: number; distinct: number }[]
  trace?: ProofTraceState[]
  graph?: ProofGraph
  /** Why there is no graph, when there is none: the model was too big to dump, say. */
  graphNote?: string
  definitions: ProofDefinition[]
  /** The proof, when TLAPS ran. `strict` is whether it ran with `--strict`; only then can a step count as proved. */
  proof?: { strict: boolean; obligations: ProofObligation[] }
  log: ProofLogLine[]
}

/** Which tools hobkin found, for the setup button. Null when missing. */
export interface ProofTools {
  java: string | null
  tlc: string | null
  tlaps: string | null
}

/** The `proofs` slice of the state message: running runs and the 20 most recent, newest first, and the tools. */
export interface ProofsState {
  runs: ProofRunSummary[]
  tools?: ProofTools
}
