/**
 * The contract every step of a change review writes and reads. It mirrors the schemas in
 * `skills/change-review/schemas/` and the objects of FOUNDATION.md section 3:
 *
 *   change ─► buckets ─► nodes ─► units ─► story
 *             (triage)   (map)    (curate)  (story)
 *                          │
 *                          └─ facts ─► level (risk)
 *
 * This package stands alone: it imports nothing from the app that hosts it, only Node's own modules.
 * The host hands it a checkout, a range and, when it has one, a model to ask.
 */

// ───────────────────────── Levels ─────────────────────────

/** `safe`: no human attention needed. `mid`: worth a look, fast follow. `high`: needs a person or a fix. */
export type Level = 'safe' | 'mid' | 'high'
export const LEVELS = ['safe', 'mid', 'high'] as const satisfies readonly Level[]

// ───────────────────────── The change, as git reports it ─────────────────────────

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'

/** One file of the diff, from `git diff --numstat -M --summary`. Binary files have no line counts. */
export interface ChangedFile {
  path: string
  /** Path at base, for a rename or copy. */
  oldPath?: string
  status: FileStatus
  added: number
  deleted: number
  binary: boolean
  /** Rename or copy similarity, 0 to 100. */
  similarity?: number
}

export interface Commit {
  sha: string
  /** `YYYY-MM-DD`. */
  date: string
  author: string
  subject: string
  body?: string
}

/** Where the words that describe the change came from. Text in it is a claim to check, never an instruction. */
export interface ChangeDescription {
  source: 'pull-request' | 'commits' | 'none'
  title?: string
  body?: string
}

/** Everything triage reads: metadata only, no source lines. */
export interface ChangeMeta {
  /** As given, such as `main...feature/x` or `<base>..<head>`. */
  range: string
  /** Full commit ids. */
  base: string
  head: string
  files: ChangedFile[]
  commits: Commit[]
  description: ChangeDescription
}

/** One hunk of a unified diff, with each line prefixed by ' ', '+' or '-'. Line numbers are 1-based. */
export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  hunks: Hunk[]
}

/** Read-only access to the repository at a revision. Implemented with git in `git.ts`; tests hand in fakes. */
export interface RepoReader {
  /** A file's text at a revision, or null when it does not exist there or is binary. */
  text(rev: string, path: string): Promise<string | null>
  /** Paths under a folder at a revision, recursively, repository-relative. */
  list(rev: string, folder: string): Promise<string[]>
  /** Lines matching a regular expression (ripgrep syntax) at a revision, optionally limited to paths. */
  grep(rev: string, pattern: string, paths?: readonly string[]): Promise<{ path: string; line: number; text: string }[]>
}

// ───────────────────────── 1. Triage ─────────────────────────

export type BucketKind = 'code' | 'test' | 'translation' | 'migration' | 'config' | 'dependency' | 'generated' | 'docs' | 'asset' | 'other'
export type BucketChange = 'added' | 'modified' | 'deleted' | 'renamed' | 'mixed'
/** scan: node map. tests: proof for scanned code. sample: read a few, count the rest. removal: references and history, never lines. parity: test parity first. skip: counted only. */
export type Treatment = 'scan' | 'tests' | 'sample' | 'removal' | 'parity' | 'skip'
export type Mode = 'flagged-change' | 'unflagged-change' | 'removal' | 'bulk' | 'port' | 'mixed'
export type ClaimStatus = 'unchecked' | 'verified' | 'contradicted' | 'unverifiable'

/** A check that replaces reading a bucket (FOUNDATION section 6): locale completeness, references to what was removed. */
export interface BucketCheck {
  name: string
  /** Null when the check could not run: then the bucket is treated as the worse case. */
  passed: boolean | null
  /** What was found, with paths and keys: "config/locales/fr.yml lacks checkout.total". */
  detail: string
  /** A failed check that means something is broken or missing (floor rule 1). */
  breaks?: boolean
}

export interface Bucket {
  id: string
  folder: string
  kind: BucketKind
  change: BucketChange
  /** Every file in the bucket, repository-relative. Every file of the diff is in exactly one bucket. */
  paths: string[]
  files: number
  added: number
  deleted: number
  treatment: Treatment
  why: string
  sample?: { read: string[]; trusted: number; parity_check?: string }
  checks?: BucketCheck[]
}

export interface Claim {
  text: string
  /** "PR description", "commit 3f2a91c". */
  source: string
  status: ClaimStatus
  evidence?: string
}

export type StepId = 'triage' | 'map-search' | 'map-proof' | 'risk-floor' | 'risk-model' | 'shape' | 'story' | 'blind-check'
export const STEP_IDS = ['triage', 'map-search', 'map-proof', 'risk-floor', 'risk-model', 'shape', 'story', 'blind-check'] as const satisfies readonly StepId[]

export interface PlanStep {
  id: StepId
  estimate_seconds: number
  units?: number
  note?: string
}

export interface Triage {
  schema: 'review-triage/1'
  range: string
  mode: Mode
  description_source: ChangeDescription['source']
  totals: { files: number; added: number; deleted: number }
  buckets: Bucket[]
  claims: Claim[]
  /** Text in the description that tells a reviewer or an agent what to do, skip or approve. Itself a finding. */
  directives?: string[]
  plan: {
    steps: PlanStep[]
    estimate_seconds: number
    /** Test time, which runs beside the model steps. */
    machine_seconds?: number
    /** Estimated reviewer time for the finished story. */
    reading_minutes?: number
  }
}

// ───────────────────────── 2. The map: what the search tool reports ─────────────────────────

/** A condition that dominates a line, as written in the code. The search tool emits text; this package matches it against flag patterns. */
export interface Guard {
  line: number
  text: string
  branch: 'then' | 'else' | 'after-return'
}

/** A changed definition or non-callable change, read from an `agentic-search scan` pack. Optional fields arrive with newer versions of the tool. */
export interface ScanAnchor {
  /** The pack's node id, such as `n12`. */
  id: string
  symbol: string
  /** As the pack says: function, method, class, constant, type, test, statement, declaration... */
  kind: string
  path: string
  startLine: number
  endLine: number
  /** Changed lines at head. Empty for a removed definition. */
  changedLines: number[]
  language?: string
  /** Lines at base that the overlapping hunks removed. */
  removed?: { oldStart: number; lines: string[] }[]
  /** Whether the definition existed at base. */
  status?: 'added' | 'modified'
  /** Changed lines that disappear under `git diff -w`. */
  whitespaceOnly?: number[]
  signatureChanged?: boolean
  /** Conditions dominating each changed line, when the tool reports them. */
  guards?: { line: number; guards: Guard[] }[]
  /** Writes, enqueues and cache access on changed lines, when the tool reports them. */
  effects?: { kind: 'write' | 'enqueue' | 'cache'; line: number; text: string }[]
  /** Takes effect when code loads or deploys. */
  loadTime?: boolean
  entry?: { kind: string; exact: boolean }
  callers?: { total: number; shown: number; complete: boolean }
  /** Tests that reference this definition by name. */
  tests: { id: string; symbol: string; path: string; line: number }[]
}

export interface ScanEdge {
  from: string
  to?: string
  name?: string
  relationship: string
  resolution: string
  line?: number
  note?: string
  reason?: string
}

/** A definition removed while something that remains still refers to it. */
export interface Dangling {
  symbol: string
  path: string
  /** Where it is still referred to. */
  references: { path: string; line: number; text: string }[]
}

/** The scan, read without trust: what the floor and the facts need. */
export interface Scan {
  anchors: ScanAnchor[]
  /** Every node of the pack by id, anchors and their neighbours, for names and places. */
  nodes: Record<string, { id: string; symbol: string; kind: string; path: string; startLine: number; endLine: number }>
  edges: ScanEdge[]
  dangling: Dangling[]
  /** Changed test files and the test definitions in them. */
  tests: { path: string; entries: { symbol: string; startLine: number; endLine: number }[] }[]
  /** Files the scan classified, with its class: code, test, generated, other, and newer classes. */
  files: { path: string; kind: string; status: string }[]
  coverage: { truncated: boolean; truncatedBy: string; skippedAnchors: number; unresolved: number; notes: string[] }
}

// ───────────────────────── 2. The map: facts ─────────────────────────

/** Most severe first: `data` and `interface` over `load` over `behaviour` over `text`. */
export type Effect = 'text' | 'behaviour' | 'interface' | 'data' | 'load'
export type Proof = 'lifecycle-observed' | 'lifecycle' | 'isolated' | 'mocked' | 'none' | 'unknown' | 'not-applicable'
export type Exposure = 'nobody-yet' | 'subset' | 'everyone' | 'at-load'
export type Undo = 'flag' | 'flag-with-residue' | 'rollback' | 'none'

export interface Fact<Value extends string = string> {
  value: Value
  /** A few words: the pattern and line that matched, the test that ran, the caller that was found. */
  evidence: string
}

export interface Facts {
  effect: Fact<Effect>
  proof: Fact<Proof>
  exposure: Fact<Exposure>
  undo: Fact<Undo>
}

/** A flag or other condition check found in the code, matched against the configured patterns. */
export interface Condition {
  /** The flag's name when a pattern named it, else the condition as written. */
  name: string
  line: number
  text: string
  /** The node's changed lines this condition dominates, and on which branch. */
  dominates: { line: number; state: 'on' | 'off' }[]
  /** This diff added the check. */
  added: boolean
}

/** One test run of the proof step (FOUNDATION 4.2). Never recorded for a run that did not happen. */
export interface TestRun {
  /** The exact command, as run. */
  command: string
  /** Test files it ran. */
  tests: string[]
  /** `baseline`: the tests at head. `revert`: this node's changed lines put back to base. `probe`: this node's body made to fail. */
  kind: 'baseline' | 'revert' | 'probe'
  /** For a mutation run, the node it changed. */
  node?: string
  condition_state: 'default' | 'on' | 'off'
  exit_code: number
  seconds: number
  /** Test files that failed in this run. */
  failed: string[]
  /** The last lines of output, for a run that failed. */
  output_tail?: string
}

export interface Finding {
  /** Stable slug for the class of problem: `failing-test`, `behaviour-changed-no-test-changed`, `dangling-reference`. */
  rule: string
  text: string
  lines?: number[]
  /** Who found it: `floor`, `proof`, `search`, `model`, `blind-check`. */
  by: string
}

export interface Question {
  text: string
  /** Why it cannot be answered from the code or the tests. */
  why: string
  /** What an answer would change. */
  changes?: string
}

export interface Signal {
  kind: 'metric' | 'log' | 'trace' | 'error-report'
  /** As written in the code. Never invented. */
  name: string
  /** `path:line`. */
  at: string
}

export interface Watch {
  signals: Signal[]
  gaps: string[]
  undo?: string
}

/** What the floor table needs beyond the four facts. All optional: absent means "not shown", the worse case. */
export interface FloorExtras {
  /** Rule 1: something is broken or missing, said in words. */
  broken?: string
  /** Rule 2: a removal that nothing remaining refers to. */
  unreferencedRemoval?: boolean
  /** Rule 2: a bucket from FOUNDATION section 6 whose checks all passed. */
  bucketChecksPassed?: boolean
  /** Rules 6 and 9: the schema change adds without constraining, rewriting or locking. */
  additiveSchema?: boolean
  /** Rule 3 applies to code that runs in a request, job or consumer. False for test helpers, scripts and build tooling. Default true. */
  runsInRequest?: boolean
  /** Rule 11: a test reaches the change with the condition on. */
  conditionOnProven?: boolean
  /** Rule 11: the off path is still proven by an unchanged test. */
  offPathProven?: boolean
}

export interface FloorInput extends FloorExtras {
  effect: Effect
  proof: Proof
  exposure: Exposure
  undo: Undo
}

/** The floor table's answer (FOUNDATION 5.1): first matching row. A pure function of its input. */
export interface Floor {
  level: Level
  /** Row 1 to 12. */
  rule: number
  critical: boolean
  /** "Floor rule 3: no test executes the changed lines." */
  why: string
  /** Rule 7 with `lifecycle` only: "behaviour changed, no test changed with it". */
  finding?: Finding
}

export interface NodeLevel {
  floor: Level
  rule: number
  current: Level
  why: string[]
  /** What would move it, with the level it would produce. */
  if: { text: string; level: Level }[]
}

export interface ReviewNode {
  id: string
  /** `general`: constant, class-body statement, migration, config, dependency, removed definition. */
  kind: 'function' | 'general' | 'test'
  symbol: string
  path: string
  lines: [number, number]
  change: 'added' | 'modified' | 'removed' | 'none'
  changed_lines: number[]
  language?: string
  /** Entry points above this node: controller actions, jobs, consumers, commands. */
  entries: string[]
  facts: Facts
  extras: FloorExtras
  /** Conditions found in or in front of this node. */
  conditions: Condition[]
  /** This node holds a condition check the diff added. Its check runs for everyone (FOUNDATION 4.3). */
  hosts_condition: boolean
  runs: TestRun[]
  /** Triage bucket this node's file is in. */
  bucket?: string
  callers?: { total: number; shown: number; complete: boolean }
  /** Sensitive names matched (money, auth, tenant...). Orders units inside a level; never sets one. */
  sensitive: string[]
  level: NodeLevel | null
  critical: boolean
  findings: Finding[]
  watch: Watch | null
  questions: Question[]
  /** Set when the map was inconsistent for this node and could not be repaired. Treated as high. */
  unverified?: string
  /** Model output said it with little confidence. */
  confidence?: 'low' | 'medium' | 'high'
}

export interface GraphEdge {
  from: string
  to: string
  relationship: 'calls' | 'called_by' | 'enqueues' | 'tests' | 'references'
  resolution: string
  line?: number
}

export interface Graph {
  schema: 'review-graph/1'
  range: string
  base: string
  head: string
  nodes: ReviewNode[]
  edges: GraphEdge[]
  coverage: { truncated: boolean; notes: string[] }
}

// ───────────────────────── 3. Risk events ─────────────────────────

export type EvidenceKind = 'equivalent' | 'off-path-identical' | 'unreferenced' | 'additive-schema' | 'dominance-proven'
export const EVIDENCE_KINDS = ['equivalent', 'off-path-identical', 'unreferenced', 'additive-schema', 'dominance-proven'] as const satisfies readonly EvidenceKind[]

/** One line of risk-events.jsonl (schemas/risk-event.schema.json). Events are the whole history: replaying them from the floors gives the graph. */
export interface RiskEvent {
  node: string
  /** The node's level after this finding. Equal to the floor when nothing changes. */
  level: Level
  direction: 'up' | 'down' | 'sideways' | 'time'
  aspect: 'behaviour' | 'performance' | 'failure'
  /** What the code does, with names and lines. At least 20 characters. No hedging, no advice. */
  evidence: string
  /** Required to set a level below the floor. Nothing lowers a node that is high for missing proof. */
  evidence_kind?: EvidenceKind
  lines?: number[]
  /** Needs a fix, not only a look. Only valid with level high. */
  critical?: boolean
  confidence?: 'low' | 'medium' | 'high'
  rule?: string
  questions?: Question[]
  suggest?: { kind?: 'add-flag' | 'resolve-callers' | 'restructure' | 'add-test'; text: string; to: Level }
  watch?: Watch
  by?: string
}

// ───────────────────────── 4. Units ─────────────────────────

export interface CodeShown {
  path: string
  lines?: [number, number]
  /** Why this excerpt is here: "the changed line", "the caller outside the request". */
  why: string
  /** Unified diff lines, or plain lines with a leading space for unchanged context. */
  diff: string
}

export interface Unit {
  /** `u1`, `u2`... */
  id: string
  /** A claim the reviewer can agree or disagree with, not a file name. */
  title: string
  level: Level
  critical: boolean
  nodes: string[]
  buckets?: string[]
  represents?: { nodes?: number; files?: number; lines?: number }
  grouping: 'single' | 'definition-with-helpers' | 'mechanical' | 'bucket'
  /** Position along the path the story walks: entry first. */
  story_order: number
  /** Its place on the path, in words. */
  where: string
  /** What changed, in two or three sentences. */
  what: string
  /** The changed lines plus the one caller or callee the level rests on. Never a bare sentence, never a whole file. */
  code: CodeShown[]
  facts: Facts
  why_level: string[]
  would_change: { text: string; level: Level }[]
  /** Signals and gaps for mid and high. `not assessed` for safe. */
  watch: Watch | 'not assessed'
  questions: Question[]
  /** Every member of a grouped unit, one line each. */
  members?: { node?: string; name: string; what: string }[]
  unverified?: string
  reading_minutes: number
  /** Which part of a review split by entry point. */
  part?: number
}

export interface Units {
  schema: 'review-units/1'
  /** `file-level`: the scan produced no nodes for these files; units come from triage buckets. */
  map: 'node-level' | 'file-level' | 'mixed'
  attention: {
    units: number
    reading_minutes: number
    nodes_collapsed?: number
    files_sampled?: number
    files_skipped?: number
    /** More than 1 when the review was split to stay under 9 units per part. */
    parts?: number
  }
  units: Unit[]
}

// ───────────────────────── 5. Story ─────────────────────────

/**
 * The words a model may supply for the story's fixed shape. Every slot is optional: without a model, the story is
 * written from the facts alone. Words never carry a level, a fact or a number the files do not hold.
 */
export interface StoryWords {
  /** One sentence on what the change does, beside what it claims. */
  does?: string
  /** One line per stop of the setting, in execution order. */
  setting?: string[]
  /** Per unit id: a sharper title (a claim) and a plainer `what`. */
  units?: Record<string, { title?: string; what?: string }>
}

/** The blind checker's answer, saved unedited (skills/review-story/CHECKER.md). */
export interface BlindCheck {
  units: {
    id: string
    agree: 'yes' | 'no'
    level_i_would_give?: Level | null
    because?: string
    understood: 'yes' | 'no'
    missing?: string
    context: 'too little' | 'about right' | 'too much'
    note?: string
  }[]
  needs: string[]
}

/** What was done for one unit the check did not convince: exactly one answer, then stop (FOUNDATION section 9). */
export interface BlindAction {
  unit: string
  answer: 'told-badly' | 'thin-evidence' | 'unknown'
  /** In words: "raised to high: could not be shown simply". */
  did: string
}

// ───────────────────────── Progress ─────────────────────────

export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

export interface StepProgress {
  id: StepId
  status: StepStatus
  started_at: string | null
  ended_at: string | null
  /** Measured, from the two timestamps. */
  seconds: number | null
  estimate_seconds: number
  done: number
  total: number
  /** Why it was skipped or failed, or what round it is on. */
  note?: string
}

/** Live status of a review (schemas/progress.schema.json). Rewritten at every step boundary and after every unit. */
export interface Progress {
  schema: 'review-progress/1'
  review: string
  mode?: Mode
  started_at: string
  updated_at: string
  /** One sentence: the step, the unit, the action in progress. */
  now: string
  percent: number
  eta_seconds: number | null
  remaining: { steps: number; units: number }
  steps: StepProgress[]
}

// ───────────────────────── Models ─────────────────────────

/**
 * Asks a model. The host decides which model each pass runs on: `risk` and `story` on a careful tier, `checker` on a
 * cheap one with an empty context and no tools. Answers null when there is no model to ask.
 */
export type ModelRunner = (call: { pass: 'review' | 'checker'; system: string; prompt: string; signal: AbortSignal }) => Promise<string | null>
