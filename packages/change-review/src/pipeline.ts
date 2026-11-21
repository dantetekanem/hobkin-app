/**
 * A whole change review, end to end (skills/change-review): triage, the map by search, proof by the repository's own
 * tests and by the TLA+ model checks hobkin ran at the head, the floor, the units, one model call that reviews and
 * reorganizes the map, the story and one blind check. Every step is tracked in
 * progress.json, and everything a step decides is written beside it, so the story never says what the files do not.
 *
 * The checkout at `cwd` must hold the change at `head`, clean: proof changes a definition, runs its tests and puts it
 * back. Without a model, or with one that fails, the review still finishes: levels stay at their floors and the story
 * is written from facts. A review its signal stops ends with an error, never with a result that looks finished.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deployAnswer, type DeployAnswer } from './answer.ts'
import { blindActions, runBlindCheck } from './blind.ts'
import { DEFAULT_CONFIG, isEntryPath, isLifecycleTestPath, isNotRequestPath, rx, type ReviewConfig } from './config.ts'
import { changesCode, curate, type Layout, NOT_MAPPED, standsAloneIn } from './curate.ts'
import { type EntriesSearch, type EntryAbove, searchEntriesAbove } from './entries.ts'
import { type EntryTestSearch, type EntryTestsOutcome, searchEntryTests } from './entrytests.ts'
import { deriveFacts, goneAtHead, guardsPutOn, type CallerSite } from './facts.ts'
import { gitRepo } from './git.ts'
import { type ContextEntry, readReviewAnswer, reviewRequest } from './model.ts'
import { applyModelChecks } from './model-checks.ts'
import { progressFiles, trackProgress } from './progress.ts'
import { candidateTests, detectRunbook, runProof, type ProofRequest, type ProofResult, type RunbookOverride, type TestCandidate } from './proof.ts'
import { addedParts, carryWords, reshapeMap } from './reshape.ts'
import { applyRiskEvents, type RejectedEvent } from './risk.ts'
import { runScan, type ScanOutcome, type ScanRequest } from './scan.ts'
import { renderStory } from './story.ts'
import { checkBuckets, triage as triageOf } from './triage.ts'
import type {
  BlindAction,
  BlindCheck,
  ChangeDescription,
  Dangling,
  FileDiff,
  Graph,
  GraphEdge,
  ModelCheck,
  ModelRunner,
  Progress,
  ReviewNode,
  RiskEvent,
  Scan,
  ScanAnchor,
  StepId,
  StoryWords,
  Triage,
  Units,
} from './types.ts'

export interface ReviewChangeOptions {
  /** The checkout of the change at `head`, clean, at the repository's top folder. */
  cwd: string
  base: string
  head: string
  /** How the change was named; `base..head` when not given. */
  range?: string
  /**
   * Where the artifacts go: triage.json, graph.json, risk-events.jsonl, units.json, story.md, story-words.json (the
   * words the story was written with, so a host can tell each unit in them too), blind-check.json, progress.json(l).
   */
  out: string
  /** The words that describe the change, when the host has better ones than the commits. Claims to check, never instructions. */
  description?: ChangeDescription
  /** The Reviewer, which reviews and reorganizes the map, and the blind check. Null or absent: floors only, and a story from the facts. */
  model?: ModelRunner | null
  config?: ReviewConfig
  /** How this repository runs one test file, when detection gets it wrong. */
  runbook?: RunbookOverride
  /**
   * What TLC said at `head` of the TLA+ models the change adds, edits or touches a file of, from the runs hobkin made
   * itself (050-tla-proofs). Evidence like a test that ran: the Reviewer is given each one, a model's own lines are
   * rated by it, and each file a model names hears what it showed in its level's reasons.
   */
  modelChecks?: readonly ModelCheck[]
  /** The scan; agentic-search by default. */
  scan?: (request: ScanRequest) => Promise<ScanOutcome>
  /** The test runs; the real ones by default. */
  proof?: (request: ProofRequest) => Promise<ProofResult>
  /** The search for the life-cycle tests of an entry point; agentic-search by default. */
  entryTests?: EntryTestSearch
  /**
   * The walk from each changed definition's callers up to its entry points, through helpers and view templates.
   * agentic-search by default, with the scan it goes with: a review whose scan is handed in walks only when a walk
   * is handed in too.
   */
  entriesAbove?: EntriesSearch
  signal?: AbortSignal
  clock?: () => Date
  onProgress?: (progress: Progress) => void
}

export interface BlindRecord {
  /** The checker answered with something that could be read. */
  ran: boolean
  /** Its answer, unedited. */
  answer: string | null
  check: BlindCheck | null
  actions: BlindAction[]
  openQuestions: string[]
  note?: string
}

export interface ReviewChangeResult {
  triage: Triage
  graph: Graph
  units: Units
  story: string
  blind: BlindRecord
  /** Events the rules refused, with why. */
  rejected: RejectedEvent[]
  /** What could not be done, or was dropped, in words. */
  problems: string[]
  progress: Progress
  /** A model wrote the story's words, or the facts alone did. */
  storyBy: 'model' | 'host'
  /** The one answer for the whole change: risky or safe to deploy, and why. */
  answer: DeployAnswer
}

/** Lines of a test that put a double in place of a definition; `sym` stands for its name. */
const DOUBLE_PATTERNS = [
  'stubs?\\(:sym\\b',
  'receive\\(:sym\\b',
  'expects\\(:sym\\b',
  "mock\\.method\\([^)]*['\"]sym['\"]",
  "spyOn\\([^)]*['\"]sym['\"]",
  "sinon\\.stub\\([^)]*['\"]sym['\"]",
  'vi\\.mock\\(',
  'jest\\.mock\\(',
]

/** How far up the call graph the review looks for the entry points above a node. */
const ENTRY_HOPS = 4
/** The most entry points above one node whose tests are looked for, the nearest first, and the most life-cycle test files run for it. */
const MOST_ENTRIES = 4
const MOST_FLOW_FILES = 6

/** Written in full beside the file, then put in place, so a reader never sees half of it. */
function writeWhole(file: string, text: string) {
  const next = `${file}.${process.pid}.next`
  writeFileSync(next, text, { mode: 0o600 })
  renameSync(next, file)
}

const json = (value: unknown) => `${JSON.stringify(value, null, 1)}\n`
const readOr = (file: string) => {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** Every file a scan bucket holds, and the sites read of an identical-edit bucket: what the map reads line by line. */
function filesToMap(result: Triage): Set<string> {
  const files = new Set<string>()
  for (const bucket of result.buckets) {
    if (bucket.treatment === 'scan' || bucket.treatment === 'tests') for (const path of bucket.paths) files.add(path)
    if (bucket.treatment === 'sample' && bucket.kind === 'code') for (const path of bucket.sample?.read ?? []) files.add(path)
  }
  return files
}

/** A TypeScript type alias or interface: erased before the code runs, so the compiler checks it, not a test. */
const isTypeOnly = (anchor: ScanAnchor) => ['type', 'interface', 'type_alias'].includes(anchor.kind) && /\.[cm]?tsx?$/.test(anchor.path)

/** The kind of node a scan anchor makes: tests apart (with every helper in a test file), then types and what takes effect at load, then definitions. */
function kindOf(anchor: ScanAnchor, inTests: boolean): ReviewNode['kind'] {
  if (anchor.kind === 'test' || inTests) return 'test'
  if (isTypeOnly(anchor) || ['constant', 'statement', 'declaration', 'class', 'module'].includes(anchor.kind) || anchor.loadTime) return 'general'
  return 'function'
}

/**
 * Whether a definition is new, changed or gone: the search tool says so when it can. Otherwise one with no changed
 * line at head is removed only when it is shown gone, since one still there had lines deleted inside it; and one
 * whose every line changed and that took nothing away at base is taken as added.
 */
function changeOf(anchor: ScanAnchor, atHead: readonly string[] | null): ReviewNode['change'] {
  if (anchor.status) return anchor.status
  if (!anchor.changedLines.length) return goneAtHead(anchor, atHead) ? 'removed' : 'modified'
  const span = anchor.endLine - anchor.startLine + 1
  return anchor.changedLines.length >= span && !(anchor.removed ?? []).some((block) => block.lines.length) ? 'added' : 'modified'
}

/** The node for a removed definition that something remaining still refers to: broken, decided by search alone. */
function brokenReferenceNode(dangling: Dangling, id: string): ReviewNode {
  const where = dangling.references
    .slice(0, 3)
    .map((ref) => `${ref.path}:${ref.line}`)
    .join(', ')
  const verb = dangling.references.length === 1 ? 'refers' : 'refer'
  return {
    id,
    kind: 'general',
    symbol: dangling.symbol,
    path: dangling.path,
    lines: [1, 1],
    change: 'removed',
    changed_lines: [],
    entries: [],
    facts: {
      effect: { value: 'interface', evidence: 'a definition was removed' },
      proof: { value: 'not-applicable', evidence: 'a broken reference is decided by search, not by a test' },
      exposure: { value: 'everyone', evidence: `still referred to at ${where}` },
      undo: { value: 'rollback', evidence: 'reverting the deploy restores the definition' },
    },
    extras: { broken: `${where} still ${verb} to ${dangling.symbol}, which this diff removes.` },
    conditions: [],
    hosts_condition: false,
    runs: [],
    sensitive: [],
    level: null,
    critical: false,
    findings: [{ rule: 'dangling-reference', text: `${dangling.symbol} is removed while ${where} still refers to it.`, by: 'search' }],
    watch: null,
    questions: [],
  }
}

/** What the review works from when the scan could not run: nothing found, and the coverage says it failed. */
const failedScan = (): Scan => ({
  anchors: [],
  nodes: {},
  edges: [],
  dangling: [],
  tests: [],
  files: [],
  coverage: { truncated: true, truncatedBy: 'failed', skippedAnchors: 0, unresolved: 0, notes: [] },
})

/**
 * A part for each changed file the scan was given and holds nothing for, where more than comments or blank lines
 * changed: a language the search tool has no parser for, a file it found no definition in, or any file when the scan
 * could not run. It is built from the file's diff, so the Reviewer reads its changed lines like any other part's.
 * Nothing mapped it, so no test was looked for: it starts at worth a look, and an argument alone never lowers that.
 */
async function diffParts({ triage, diffs, nodes, scan, scanned, linesAt, base, head, config }: {
  triage: Triage
  diffs: readonly FileDiff[]
  nodes: readonly ReviewNode[]
  scan: Scan
  scanned: ScanOutcome
  linesAt: (rev: string, path: string) => Promise<string[] | null>
  base: string
  head: string
  config: ReviewConfig
}): Promise<ReviewNode[]> {
  const taken = new Set(nodes.map((node) => node.id))
  const has = new Set(nodes.map((node) => node.path))
  const parts: ReviewNode[] = []
  for (const bucket of triage.buckets.filter((entry) => entry.treatment === 'scan' && entry.kind !== 'test')) {
    for (const path of bucket.paths) {
      const file = diffs.find((entry) => entry.path === path)
      if (has.has(path) || !file?.hunks.length) continue
      const before = file.oldPath ?? path
      const [atHead, atBase] = [(await linesAt(head, path))?.join('\n') ?? null, (await linesAt(base, before))?.join('\n') ?? null]
      if (!changesCode({ source: (at, side) => (side === 'head' ? (at === path ? atHead : null) : at === before ? atBase : null) }, file)) continue
      const added: number[] = []
      for (const hunk of file.hunks) {
        let at = hunk.newStart
        for (const line of hunk.lines) {
          if (line[0] === '+') added.push(at)
          if (line[0] !== '-') at += 1
        }
      }
      const isNew = file.hunks.every((hunk) => hunk.oldStart === 0 && hunk.oldLines === 0)
      const isGone = file.hunks.every((hunk) => hunk.newStart === 0 && hunk.newLines === 0)
      const why = !scanned.ok
        ? `The scan could not run (${scanned.reason.replace(/\.$/, '')})`
        : scan.files.some((entry) => entry.path === path && !entry.language)
          ? 'The search tool has no parser for it'
          : 'The search tool found no definition in it'
      let id = `d${parts.length + 1}`
      while (taken.has(id)) id = `${id}x`
      taken.add(id)
      parts.push({
        id,
        kind: 'general',
        symbol: path,
        path,
        // Every hunk, so the Reviewer is shown every one.
        lines: [Math.min(...file.hunks.map((hunk) => hunk.newStart)), Math.max(...file.hunks.map((hunk) => hunk.newStart + Math.max(hunk.newLines, 1) - 1))],
        change: isNew ? 'added' : isGone ? 'removed' : 'modified',
        changed_lines: added,
        entries: [],
        facts: {
          effect: { value: 'behaviour', evidence: 'what the changed lines do is read from the diff' },
          proof: { value: 'unknown', evidence: 'no definition was mapped, so no test was looked for' },
          exposure: { value: 'everyone', evidence: 'no condition in front of it was looked for' },
          undo: { value: 'rollback', evidence: 'a rollback undoes it' },
        },
        extras: isNotRequestPath(path, config) ? { runsInRequest: false } : {},
        conditions: [],
        hosts_condition: false,
        runs: [],
        bucket: bucket.id,
        sensitive: [],
        level: null,
        critical: false,
        findings: [{ rule: NOT_MAPPED, text: `${why}, so what calls it and what tests it were not looked for, and its change is judged from the diff alone.`, by: 'search' }],
        watch: null,
        questions: [],
      })
    }
  }
  return parts
}

/** The name a symbol is called by: `total` for `Cart#total` or `Billing::Cart.total`. */
const shortName = (symbol: string) => symbol.split(/#|::|\./).filter(Boolean).at(-1) ?? symbol

/** The changed lines of one node, from the hunks that touch it, as a small diff. */
function changedExcerpt(diffs: readonly FileDiff[], node: Pick<ReviewNode, 'path' | 'lines'>): string {
  const file = diffs.find((diff) => diff.path === node.path)
  if (!file) return ''
  const [start, end] = node.lines
  return file.hunks
    .filter((hunk) => hunk.newStart <= end && hunk.newStart + Math.max(hunk.newLines, 1) - 1 >= start)
    .map((hunk) => hunk.lines.join('\n'))
    .join('\n…\n')
}

/** Entry points above a node: walk the callers up to a few hops and keep those whose path is an entry. */
function entriesOf(scan: Scan, anchor: ScanAnchor, config: ReviewConfig): string[] {
  const entries = new Set<string>()
  // Once: an entry point the tool named keeps its kind, and the path rule adds only one it did not name.
  if (anchor.entry) entries.add(`${anchor.symbol} (${anchor.entry.kind})`)
  else if (isEntryPath(anchor.path, config)) entries.add(anchor.symbol)
  let frontier = [anchor.id]
  const seen = new Set(frontier)
  for (let hop = 0; hop < ENTRY_HOPS && frontier.length; hop += 1) {
    const next: string[] = []
    for (const id of frontier) {
      for (const edge of scan.edges) {
        if (edge.relationship !== 'called_by' || edge.to !== id || seen.has(edge.from) || edge.note === 'test') continue
        seen.add(edge.from)
        next.push(edge.from)
        const caller = scan.nodes[edge.from]
        if (caller && isEntryPath(caller.path, config)) entries.add(caller.symbol)
      }
    }
    frontier = next
  }
  return [...entries]
}

/**
 * The callers the scan found for an anchor, and whether each call sits on the on branch of a flag check, by the guards
 * the tool reports for the call. A pack with no `called_by` edge for the anchor but a call-site list is read from that.
 */
function callersOf(scan: Scan, anchor: ScanAnchor, config: ReviewConfig): CallerSite[] {
  const edges = scan.edges.filter((edge) => edge.relationship === 'called_by' && edge.to === anchor.id && edge.note !== 'test')
  const fromEdges = edges.flatMap((edge) => {
    const caller = scan.nodes[edge.from]
    return caller ? [{ path: caller.path, line: edge.line ?? caller.startLine, guardedOn: guardsPutOn(edge.guards ?? [], config) }] : []
  })
  if (fromEdges.length || edges.length) return fromEdges
  return (anchor.callSites ?? []).map((site) => ({ path: site.path, line: site.line, guardedOn: guardsPutOn(site.guards, config) }))
}

/** The entry points a node sits under that the tool named: the node itself, and the callers that are entry points. */
function entrySymbolsOf(anchor: ScanAnchor): string[] {
  const symbols = new Set<string>()
  if (anchor.entry) symbols.add(anchor.symbol)
  for (const site of anchor.callSites ?? []) if (site.entry) symbols.add(site.symbol)
  return [...symbols]
}

/** What a call gave, or why it failed: a model that throws is a step not done, never a review that cannot be made. */
async function attempt<T>(call: () => Promise<T>): Promise<{ value: T } | { failed: string }> {
  try {
    return { value: await call() }
  } catch (error) {
    return { failed: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Reviews the change from `base` to `head`. Throws when the review cannot be made at all: the checkout cannot be
 * read, or lines that run changed in code and the scan mapped none of them (it names the files, and those it has no
 * parser for; never "nothing to review"); and when `signal` stops it, with an `AbortError` that says so. A change of
 * only comments or blank lines is no such failure. Anything less is said in the story and in
 * `problems`.
 */
export async function reviewChange(options: ReviewChangeOptions): Promise<ReviewChangeResult> {
  const { cwd, base, head, out } = options
  const config = options.config ?? DEFAULT_CONFIG
  const signal = options.signal ?? new AbortController().signal
  const stopped = () => Object.assign(new Error('The review was stopped before it finished.', { cause: signal.reason }), { name: 'AbortError' })
  if (signal.aborted) throw stopped()
  const clock = options.clock ?? (() => new Date())
  const model = options.model ?? null
  const problems: string[] = []
  mkdirSync(out, { recursive: true, mode: 0o700 })
  const save = (name: string, value: unknown) => writeWhole(join(out, name), typeof value === 'string' ? value : json(value))
  const repo = gitRepo(cwd)

  // 1. Triage: metadata only.
  const read = await repo.meta(base, head, options.range ?? `${base}..${head}`)
  const meta = options.description ? { ...read, description: options.description } : read
  const diffs = await repo.diffs(base, head)
  let triage = triageOf(meta, { diffs })
  const files = progressFiles(out)
  const tracker = trackProgress({
    review: head.slice(0, 12),
    mode: triage.mode,
    plan: triage.plan,
    clock,
    write: (progress) => {
      files(progress)
      options.onProgress?.(progress)
    },
  })
  /** Between steps: a review its signal stopped ends here, the step it stopped at marked failed. */
  const halt = (step: StepId) => {
    if (!signal.aborted) return
    tracker.fail(step, 'the review was stopped')
    throw stopped()
  }
  tracker.start('triage', 1, `triage: sorting ${triage.totals.files} changed files by kind, to see which need reading line by line`)
  triage = await checkBuckets(triage, repo, meta)
  save('triage.json', triage)
  tracker.end('triage')

  // 2. The map, by search.
  halt('map-search')
  const mapped = filesToMap(triage)
  tracker.start('map-search', 1, `map-search: finding every changed function in ${mapped.size} files, and what calls it`)
  const scanned = await (options.scan ?? runScan)({ cwd, base, head, signal })
  halt('map-search')
  const scan: Scan = scanned.ok ? scanned.scan : failedScan()
  if (scanned.ok) tracker.end('map-search')
  else {
    problems.push(`The scan could not run: ${scanned.reason}`)
    tracker.fail('map-search', scanned.reason)
  }

  const lines = new Map<string, string[] | null>()
  const linesAt = async (rev: string, path: string) => {
    const key = `${rev}:${path}`
    if (!lines.has(key)) lines.set(key, (await repo.text(rev, path))?.split('\n') ?? null)
    return lines.get(key)!
  }
  const bucketOf = (path: string) => triage.buckets.find((bucket) => bucket.paths.includes(path))?.id
  const testFiles = new Set(triage.buckets.filter((bucket) => bucket.kind === 'test').flatMap((bucket) => bucket.paths))
  const nodes: ReviewNode[] = []
  for (const anchor of scan.anchors.filter((item) => mapped.has(item.path))) {
    const atHead = await linesAt(head, anchor.path)
    const derived = deriveFacts({
      anchor,
      path: anchor.path,
      head: atHead,
      base: await linesAt(base, anchor.path),
      config,
      callers: callersOf(scan, anchor, config),
      callersComplete: anchor.callers?.complete ?? false,
    })
    const bucket = bucketOf(anchor.path)
    const change = changeOf(anchor, atHead)
    const kind = kindOf(anchor, testFiles.has(anchor.path))
    // A test is proof for the code it runs: what it writes or serializes is no change to rate (floor rule 2).
    if (kind === 'test') derived.extras.isTest = true
    nodes.push({
      id: anchor.id,
      kind,
      symbol: anchor.symbol,
      path: anchor.path,
      lines: [anchor.startLine, anchor.endLine],
      change,
      changed_lines: anchor.changedLines,
      ...(anchor.language ? { language: anchor.language } : {}),
      entries: entriesOf(scan, anchor, config),
      facts: { ...derived.facts, proof: { value: 'unknown', evidence: 'tests have not run yet' } },
      extras: isTypeOnly(anchor) ? { ...derived.extras, typeOnly: true } : derived.extras,
      conditions: derived.conditions,
      hosts_condition: derived.hosts_condition,
      runs: [],
      ...(bucket ? { bucket } : {}),
      ...(anchor.callers ? { callers: anchor.callers } : {}),
      sensitive: derived.sensitive,
      level: null,
      critical: false,
      findings: [],
      watch: null,
      questions: [],
    })
  }
  // A definition removed while something that remains still refers to it: broken, whatever else is true.
  for (const [index, dangling] of scan.dangling.entries()) nodes.push(brokenReferenceNode(dangling, `x${index + 1}`))
  const known = new Set(nodes.map((node) => node.id))
  const edges: GraphEdge[] = scan.edges.flatMap((edge) => {
    if (!edge.to || !known.has(edge.from) || !known.has(edge.to)) return []
    if (edge.relationship !== 'calls' && edge.relationship !== 'called_by' && edge.relationship !== 'enqueues') return []
    return [
      {
        from: edge.from,
        to: edge.to,
        relationship: edge.relationship,
        resolution: edge.resolution,
        ...(edge.line ? { line: edge.line } : {}),
      },
    ]
  })
  const graphOf = (list: ReviewNode[]): Graph => ({
    schema: 'review-graph/1',
    range: triage.range,
    base,
    head,
    nodes: list,
    edges,
    coverage: { truncated: scan.coverage.truncated, notes: scan.coverage.notes },
  })
  save('graph.json', graphOf(nodes))

  // 3. Proof: the repository's own tests, at head and with each changed definition undone.
  // Definitions are proven by tests. What takes effect at load (constants, config, migrations) is decided by its operation.
  for (const node of nodes.filter((item) => item.kind === 'general' && item.change !== 'removed')) {
    node.facts.proof = { value: 'not-applicable', evidence: 'takes effect when the code loads or deploys: decided by what it does, not by a test' }
  }
  // A removed definition has nothing left to run. Nothing that remains refers to it (rule 2, safe) unless the scan
  // reports a reference to a removed definition of its name, wherever it was, or was cut short; a reference found
  // makes the broken node beside it, at rule 1.
  for (const node of nodes.filter((item) => item.change === 'removed' && item.kind !== 'test' && !item.extras.broken)) {
    node.facts.proof = { value: 'not-applicable', evidence: 'removed: there is nothing left to run' }
    const referred = scan.dangling.some((entry) => shortName(entry.symbol) === shortName(node.symbol))
    if (!referred && !scan.coverage.truncated) node.extras.unreferencedRemoval = true
  }
  // What the scan was given and holds nothing for is read from its diff, never left out or only counted.
  const unmapped = await diffParts({ triage, diffs, nodes, scan, scanned, linesAt, base, head, config })
  nodes.push(...unmapped)
  if (unmapped.length) problems.push(`Read from the diff alone, with no map: ${unmapped.map((node) => `\`${node.path}\``).join(', ')}.`)
  const provable = nodes.filter((node) => node.kind === 'function' && node.change !== 'removed' && node.facts.effect.value !== 'text')
  tracker.start('map-proof', provable.length, provable.length ? 'map-proof: finding how this repository runs its tests' : 'map-proof: nothing that runs needs proof')
  const runbook = detectRunbook(cwd, options.runbook)
  const changedTests = triage.buckets.filter((bucket) => bucket.kind === 'test').flatMap((bucket) => bucket.paths).filter((path) => existsSync(join(cwd, path)))
  const candidates: Record<string, TestCandidate[]> = {}
  // One search per entry point for the whole review: many nodes can sit under the same one.
  const searched = new Map<string, Promise<EntryTestsOutcome>>()
  const testsOfEntry = (symbol: string) => {
    if (!searched.has(symbol)) {
      searched.set(
        symbol,
        (async (): Promise<EntryTestsOutcome> => {
          const asked = await attempt(() => (options.entryTests ?? searchEntryTests)({ cwd, symbol, signal }))
          const outcome: EntryTestsOutcome = 'value' in asked ? asked.value : { ok: false, reason: asked.failed }
          if (!outcome.ok) problems.push(`The search for life-cycle tests of ${symbol} failed: ${outcome.reason} Its tests are not among the candidates.`)
          return outcome
        })(),
      )
    }
    return searched.get(symbol)!
  }
  // The entry points above each definition: the callers the scan lists, followed a call at a time to where a request
  // enters. A caller that is an entry point already is one; the others are where the walk starts.
  const above: Record<string, EntryAbove[]> = {}
  const walk = options.entriesAbove ?? (options.scan ? null : searchEntriesAbove)
  const starts = provable.flatMap((node) => {
    const anchor = scan.anchors.find((item) => item.id === node.id)
    const callers = (anchor?.callSites ?? []).filter((site) => !site.entry).map(({ path, line }) => ({ path, line }))
    return anchor && !anchor.entry && callers.length ? [{ id: node.id, callers }] : []
  })
  if (walk && starts.length) {
    tracker.tick('map-proof', 0, `map-proof: following the callers of ${starts.length} changed ${starts.length === 1 ? 'definition' : 'definitions'} up to where a request enters`)
    const walked = await attempt(() => walk({ cwd, starts, isEntry: (path) => isEntryPath(path, config), signal }))
    halt('map-proof')
    if ('failed' in walked) problems.push(`The search for entry points failed: ${walked.failed}. Request tests above the changed definitions are not among the candidates.`)
    else {
      Object.assign(above, walked.value.entries)
      problems.push(...walked.value.notes.map((note) => `Entry points: ${note}`))
    }
  }
  for (const node of provable) {
    const found = [...(above[node.id] ?? [])].sort((a, b) => a.hops - b.hops).map((entry) => entry.symbol)
    for (const symbol of found) if (!node.entries.some((entry) => entry === symbol || entry.startsWith(`${symbol} (`))) node.entries.push(symbol)
    candidates[node.id] = await candidateTests({
      node,
      scan,
      changedTestPaths: changedTests,
      isLifecycleTest: (path) => isLifecycleTestPath(path, config),
      exists: (path) => existsSync(join(cwd, path)),
      read: (path) => readOr(join(cwd, path)),
    })
    const anchor = scan.anchors.find((item) => item.id === node.id)
    for (const symbol of new Set([...(anchor ? entrySymbolsOf(anchor) : []), ...found.slice(0, MOST_ENTRIES)])) {
      const outcome = await testsOfEntry(symbol)
      halt('map-proof')
      if (!outcome.ok) continue
      for (const hit of outcome.tests) {
        if (hit.path === node.path || !existsSync(join(cwd, hit.path))) continue
        const why = `life-cycle test of ${symbol}: ${hit.found}${hit.detail ? `: ${hit.detail}` : ''}`
        const have = candidates[node.id]!.find((candidate) => candidate.path === hit.path)
        if (have) {
          have.lifecycle = true
          if (!have.why.includes(why)) have.why = `${have.why}; ${why}`
        } else candidates[node.id]!.push({ path: hit.path, why, lifecycle: true, changed: changedTests.includes(hit.path) })
      }
    }
    // Each life-cycle test file is a slow run of its own: the ones this diff changed first, then as found.
    const flows = candidates[node.id]!.filter((candidate) => candidate.lifecycle).sort((a, b) => Number(b.changed) - Number(a.changed))
    if (flows.length > MOST_FLOW_FILES) {
      const left = new Set(flows.slice(MOST_FLOW_FILES))
      candidates[node.id] = candidates[node.id]!.filter((candidate) => !left.has(candidate))
      problems.push(`${left.size} of the ${flows.length} life-cycle test files found for ${node.symbol} were not run: ${MOST_FLOW_FILES} are run for one definition.`)
    }
  }
  const proved = new Set<string>()
  const proof = await (options.proof ?? runProof)({
    cwd,
    head,
    nodes: provable,
    candidates,
    runbook,
    diffs,
    doublePatterns: DOUBLE_PATTERNS,
    signal,
    onRun: (run) => {
      if (run.node) proved.add(run.node)
      const who = run.node ? (nodes.find((node) => node.id === run.node)?.symbol ?? run.node) : 'every candidate test'
      const testFileWord = run.tests.length === 1 ? 'file' : 'files'
      // A reach run is said in words of its own: a host that reads the other kinds as proof would say it proves the change.
      if (run.kind === 'reach') {
        const went = run.exit_code === 0 ? 'none runs through it' : 'at least one runs through it'
        tracker.tick('map-proof', proved.size, `map-proof: made ${who} fail and ran ${run.tests.length} request test ${testFileWord} that pass with and without the change: ${went}`)
        return
      }
      tracker.tick('map-proof', proved.size, `map-proof: ${run.kind} run for ${who}: ${run.tests.length} test ${testFileWord}, exit ${run.exit_code}`)
    },
  })
  halt('map-proof')
  if (proof.refused) problems.push(`Tests did not run: ${proof.refused}`)
  else if (!proof.clean) problems.push('The checkout was not clean after the test runs.')
  for (const node of nodes) {
    if (node.kind === 'test') node.facts.proof = { value: 'not-applicable', evidence: 'a test itself' }
    else if (node.kind === 'function' && node.facts.effect.value === 'text') {
      node.facts.proof = { value: 'not-applicable', evidence: 'only comments or whitespace changed' }
    }
    const answer = proof.nodes[node.id]
    if (answer) node.facts.proof = { value: answer.value, evidence: answer.evidence }
    if (answer?.observedBy.some((path) => changedTests.includes(path))) node.extras.testChangedWithIt = true
    const mine = new Set((candidates[node.id] ?? []).map((candidate) => candidate.path))
    node.runs = proof.runs.filter((run) => run.node === node.id || (run.kind === 'baseline' && run.tests.some((test) => mine.has(test))))
    // A test that fails with the change in place is said on the node. It is a break, and high, only when the proof
    // showed the change is why: the test passes once the definition is put back.
    for (const finding of proof.findings.filter((item) => [...mine].some((path) => item.text.startsWith(`${path} `)))) node.findings.push(finding)
    if (answer?.brokenTests?.length) {
      const files = answer.brokenTests.map((path) => `\`${path}\``).join(', ')
      node.extras.broken = `It breaks ${files}: ${answer.brokenTests.length === 1 ? 'that test passes' : 'those tests pass'} without this change and ${answer.brokenTests.length === 1 ? 'fails' : 'fail'} with it`
      node.findings.push({ rule: 'breaks-test', text: answer.evidence, by: 'proof' })
    }
    // Rule 10 needs the condition on in a test that observes it, and the off path held by an unchanged life-cycle test
    // that ran and still passed with the change undone: one never run, failing or cut short holds nothing.
    if (node.facts.exposure.value === 'nobody-yet' && answer) {
      const flags = node.conditions.map((condition) => condition.name)
      const turnsOn = (path: string) =>
        config.flags.testOn.some((pattern) =>
          flags.some((flag) => (readOr(join(cwd, path)) ?? '').match(rx(pattern))?.groups?.flag === flag),
        )
      node.extras.conditionOnProven = answer.observedBy.some(turnsOn)
      node.extras.offPathProven = (candidates[node.id] ?? []).some((candidate) => candidate.lifecycle && !candidate.changed && answer.stillPass.includes(candidate.path))
    }
  }
  // The model checks are proof too: of a model's own lines, and words beside the level of each file it models.
  const modelChecks = options.modelChecks ?? []
  applyModelChecks(nodes, modelChecks)
  tracker.end('map-proof', proof.refused ? `map-proof: no test ran: ${proof.refused}` : undefined)
  save('graph.json', graphOf(nodes))

  // 4. The floor: a table over the four facts.
  tracker.start('risk-floor', nodes.length, `risk-floor: rating ${nodes.length} changed parts from what the tests showed`)
  const before = structuredClone(nodes)
  let events: RiskEvent[] = []
  let applied = applyRiskEvents(before, events)
  tracker.end('risk-floor')

  // Units as they stand, for the Reviewer to read, name and reorganize.
  const texts = new Map<string, string | null>()
  // Every file mapped is read too, with no node in it, so a change of only comments or blank lines can be told apart.
  const mappedPaths = diffs.filter((file) => mapped.has(file.path)).flatMap((file) => [file.path, ...(file.oldPath ? [file.oldPath] : [])])
  for (const path of new Set([...nodes.map((node) => node.path), ...Object.values(scan.nodes).map((node) => node.path), ...mappedPaths])) {
    texts.set(`head:${path}`, (await linesAt(head, path))?.join('\n') ?? null)
    texts.set(`base:${path}`, (await linesAt(base, path))?.join('\n') ?? null)
  }
  const source = (path: string, side: 'head' | 'base') => texts.get(`${side}:${path}`) ?? null
  // A file the scan listed with no language is one it has no parser for; a file it did not list is not said to be.
  const unparsed = [...mapped].filter((path) => scanned.ok && scan.files.some((file) => file.path === path && !file.language))
  const shape = (list: ReviewNode[], layout?: Layout | null) => curate({ graph: graphOf(list), triage, diffs, source, scannedFiles: [...mapped], unparsed, ...(scanned.ok ? {} : { scanFailed: scanned.reason }), runsInRequest: (path) => !isNotRequestPath(path, config), ...(layout ? { layout } : {}) })
  let units = shape(applied.nodes)

  // 5. Review and reorganize the map, in one call: levels, questions, what to watch, claims, the story's words, and how
  // the map is shaped. Code checks every operation on the map; none of them sets a level.
  let words: StoryWords = meta.description.title ? { title: meta.description.title } : {}
  let storyBy: 'model' | 'host' = 'host'
  const assessed = applied.nodes.filter((node) => node.level?.current !== 'safe' || node.hosts_condition).length
  halt('risk-model')
  tracker.start('risk-model', model ? 1 : 0, model ? `risk-model: the Reviewer is reading ${assessed} changed part${assessed === 1 ? '' : 's'} to see whether anything breaks, and reorganizing the map` : 'risk-model: no model')
  if (!model) tracker.skip('risk-model', 'no model to ask: levels stay at their floors and the story is written from the facts')
  else {
    const code = Object.fromEntries(nodes.map((node) => [node.id, changedExcerpt(diffs, node)]))
    const mappedIds = new Set(nodes.map((node) => node.id))
    const context: ContextEntry[] = Object.values(scan.nodes)
      .filter((entry) => !mappedIds.has(entry.id) && entry.kind !== 'test' && !testFiles.has(entry.path))
      .sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine)
      .map((entry) => ({ symbol: entry.symbol, path: entry.path, lines: [entry.startLine, entry.endLine] }))
    const request = reviewRequest({ triage, nodes: applied.nodes, units: units.units, code, context, modelChecks })
    problems.push(...request.cut.map((cut) => `Left out of what the Reviewer read: ${cut}`))
    const asked = await attempt(() => model({ pass: 'review', system: request.system, prompt: request.prompt, signal }))
    // A call the signal stopped is the review stopping, not the model failing.
    halt('risk-model')
    const text = 'value' in asked ? asked.value : null
    if ('failed' in asked) {
      problems.push(`The Reviewer could not be asked: ${asked.failed}. Levels stay at their floors.`)
      tracker.skip('risk-model', `the Reviewer could not be asked (${asked.failed}): levels stay at their floors`)
    } else if (text == null) tracker.skip('risk-model', 'the model gave no answer: levels stay at their floors')
    else {
      const answer = readReviewAnswer(text, { nodes: applied.nodes, units: units.units, claims: triage.claims })
      const said = (problem: string) => `From the Reviewer: ${problem}`
      problems.push(...answer.problems.map(said))
      const settled = new Map(answer.claims.map((claim) => [claim.text, claim]))
      triage = { ...triage, claims: triage.claims.map((claim) => settled.get(claim.text) ?? claim) }
      // A part the Reviewer adds is checked against the diff and the scan, then rated by its floor and the events, as every part is.
      const adds = answer.map.flatMap((op) => (op.op === 'add' ? [op] : []))
      for (const op of adds) if (!texts.has(`${op.side}:${op.path}`)) texts.set(`${op.side}:${op.path}`, (await linesAt(op.side === 'base' ? base : head, op.path))?.join('\n') ?? null)
      const added = adds.length
        ? addedParts(answer.map, {
            nodes,
            diffs,
            scanned: Object.values(scan.nodes).map((entry) => ({ symbol: entry.symbol, path: entry.path, lines: [entry.startLine, entry.endLine] })),
            source,
            runsInRequest: (path) => !isNotRequestPath(path, config),
          })
        : { nodes: [], problems: [] }
      problems.push(...added.problems.map(said))
      events = [...events, ...answer.events]
      applied = applyRiskEvents([...before, ...added.nodes], events)
      const title = answer.words.title ?? words.title
      const told: StoryWords = { ...words, ...answer.words, ...(title ? { title } : {}) }
      if (answer.map.length) {
        const reshaped = reshapeMap({
          nodes: applied.nodes,
          units: units.units,
          ops: answer.map,
          added: new Set(added.nodes.map((node) => node.id)),
          claims: triage.claims,
          alone: standsAloneIn({ graph: graphOf(applied.nodes), triage, scannedFiles: [...mapped] }),
        })
        problems.push(...reshaped.problems.map(said))
        applied = { ...applied, nodes: reshaped.nodes }
        const next = shape(applied.nodes, reshaped.layout)
        words = carryWords({ ...told, units: { ...reshaped.words, ...told.units } }, reshaped.groups, next.units)
        units = next
      } else {
        const next = shape(applied.nodes)
        words = carryWords(told, units.units, next.units)
        units = next
      }
      storyBy = 'model'
      tracker.end('risk-model')
    }
  }
  save('risk-events.jsonl', events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''))
  save('triage.json', triage)

  // 6. The units, in the same shape at every level.
  tracker.start('shape', 1, `shape: grouping the changed parts into ${units.units.length} to read`)
  save('units.json', units)
  tracker.end('shape')

  // 7. The story.
  tracker.start('story', 1, 'story: writing what you will read')
  let story = renderStory({ triage, graph: graphOf(applied.nodes), units, words })
  save('story.md', story)
  save('story-words.json', words)
  tracker.end('story')

  // 8. One blind check, then rules: ask the reviewer, or note that it was told badly. It changes no level and never loops.
  const blind: BlindRecord = { ran: false, answer: null, check: null, actions: [], openQuestions: [] }
  halt('blind-check')
  if (!model) {
    blind.note = 'no model to ask'
    tracker.skip('blind-check', 'no model to ask')
  } else {
    tracker.start('blind-check', 1, 'blind-check: a second model reads the finished review as someone who knows nothing else')
    const asked = await attempt(() => runBlindCheck(model, { story, units: units.units }, signal))
    halt('blind-check')
    const checked = 'value' in asked ? asked.value : null
    blind.answer = checked?.answer ?? null
    blind.check = checked?.check ?? null
    if (!checked?.check) {
      blind.note =
        'failed' in asked
          ? `the checker failed (${asked.failed}), so the check did not run`
          : 'the checker gave no answer that could be read, so the check did not run'
      if ('failed' in asked) problems.push(`The blind check failed: ${asked.failed}. It counts as not run.`)
      tracker.skip('blind-check', blind.note)
    } else {
      blind.ran = true
      const outcome = blindActions(checked.check, units.units)
      blind.openQuestions = outcome.openQuestions
      blind.actions = outcome.actions
      units = withBlindQuestions(units, outcome)
      story = renderStory({ triage, graph: graphOf(applied.nodes), units, words, blind: checked.check, actions: blind.actions })
      save('units.json', units)
      save('story.md', story)
      tracker.end('blind-check')
    }
  }
  save('blind-check.json', blind)
  const graph = graphOf(applied.nodes)
  save('graph.json', graph)
  if (applied.rejected.length) save('rejected-events.json', applied.rejected)
  return { triage, graph, units, story, blind, rejected: applied.rejected, problems, progress: tracker.progress(), storyBy, answer: deployAnswer(units.units, words.answer, modelChecks) }
}

/** What the blind check leaves on the units: its questions, each on the unit it was asked of. It changes no level. */
function withBlindQuestions(units: Units, outcome: ReturnType<typeof blindActions>): Units {
  const next = units.units.map((unit) => {
    const asked = outcome.questions.filter((entry) => entry.unit === unit.id).map((entry) => entry.question)
    return { ...unit, questions: [...unit.questions, ...asked.filter((question) => !unit.questions.some((have) => have.text === question.text))] }
  })
  return { ...units, units: next }
}
