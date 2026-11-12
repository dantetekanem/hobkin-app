/**
 * A whole change review, end to end (skills/change-review): triage, the map by search, proof by the repository's own
 * tests, the floor, one careful model pass, the units, the story and one blind check. Every step is tracked in
 * progress.json, and everything a step decides is written beside it, so the story never says what the files do not.
 *
 * The checkout at `cwd` must hold the change at `head`, clean: proof changes a definition, runs its tests and puts it
 * back. Without a model the review still finishes: levels stay at their floors and the story is written from facts.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { blindActions, runBlindCheck } from './blind.ts'
import { DEFAULT_CONFIG, isEntryPath, isLifecycleTestPath, rx, type ReviewConfig } from './config.ts'
import { curate } from './curate.ts'
import { deriveFacts, type CallerSite } from './facts.ts'
import { gitRepo } from './git.ts'
import { readReviewAnswer, reviewRequest } from './model.ts'
import { progressFiles, trackProgress } from './progress.ts'
import { candidateTests, detectRunbook, runProof, type ProofRequest, type ProofResult, type RunbookOverride, type TestCandidate } from './proof.ts'
import { applyRiskEvents, type RejectedEvent } from './risk.ts'
import { runScan, type ScanOutcome, type ScanRequest } from './scan.ts'
import { renderStory } from './story.ts'
import { checkBuckets, triage as triageOf } from './triage.ts'
import type { BlindAction, BlindCheck, ChangeDescription, FileDiff, Graph, GraphEdge, Level, ModelRunner, Progress, Question, ReviewNode, RiskEvent, Scan, ScanAnchor, StoryWords, Triage, Unit, Units } from './types.ts'

export interface ReviewChangeOptions {
  /** The checkout of the change at `head`, clean, at the repository's top folder. */
  cwd: string
  base: string
  head: string
  /** How the change was named; `base..head` when not given. */
  range?: string
  /** Where the artifacts go: triage.json, graph.json, risk-events.jsonl, units.json, story.md, blind-check.json, progress.json(l). */
  out: string
  /** The words that describe the change, when the host has better ones than the commits. Claims to check, never instructions. */
  description?: ChangeDescription
  /** The careful pass and the blind check. Null or absent: floors only, and a story from the facts. */
  model?: ModelRunner | null
  config?: ReviewConfig
  /** How this repository runs one test file, when detection gets it wrong. */
  runbook?: RunbookOverride
  /** The scan; agentic-search by default. */
  scan?: (request: ScanRequest) => Promise<ScanOutcome>
  /** The test runs; the real ones by default. */
  proof?: (request: ProofRequest) => Promise<ProofResult>
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

/** The kind of node a scan anchor makes: tests apart, then what takes effect at load, then definitions. */
function kindOf(anchor: ScanAnchor): ReviewNode['kind'] {
  if (anchor.kind === 'test') return 'test'
  if (['constant', 'statement', 'declaration'].includes(anchor.kind) || anchor.loadTime) return 'general'
  return 'function'
}

/**
 * Whether a definition is new: the search tool says so when it can; otherwise a definition whose every line changed
 * and that took nothing away at base is taken as added.
 */
function changeOf(anchor: ScanAnchor): ReviewNode['change'] {
  if (anchor.status) return anchor.status
  if (!anchor.changedLines.length) return 'removed'
  const span = anchor.endLine - anchor.startLine + 1
  return anchor.changedLines.length >= span && !(anchor.removed ?? []).some((block) => block.lines.length) ? 'added' : 'modified'
}

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
  if (anchor.entry) entries.add(`${anchor.symbol} (${anchor.entry.kind})`)
  if (isEntryPath(anchor.path, config)) entries.add(anchor.symbol)
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

/** The callers the scan found for an anchor. Whether a call sits behind a condition is not known yet, so none counts as guarded. */
function callersOf(scan: Scan, anchor: ScanAnchor): CallerSite[] {
  return scan.edges
    .filter((edge) => edge.relationship === 'called_by' && edge.to === anchor.id && edge.note !== 'test')
    .flatMap((edge) => {
      const caller = scan.nodes[edge.from]
      return caller ? [{ path: caller.path, line: edge.line ?? caller.startLine, guardedOn: false }] : []
    })
}

/** A unit's identity across reshaping: the nodes it holds, or the buckets for a unit with no node. */
const unitKey = (unit: Pick<Unit, 'nodes' | 'buckets'>) => (unit.nodes.length ? `n:${[...unit.nodes].sort().join(',')}` : `b:${[...(unit.buckets ?? [])].sort().join(',')}`)

/** Words written for one shaping of the units, carried to another where a unit holds the same nodes. */
function carryWords(words: StoryWords, from: readonly Unit[], to: readonly Unit[]): StoryWords {
  if (!words.units) return words
  const byKey = new Map(to.map((unit) => [unitKey(unit), unit.id]))
  const units: NonNullable<StoryWords['units']> = {}
  for (const unit of from) {
    const said = words.units[unit.id]
    const id = byKey.get(unitKey(unit))
    if (said && id) units[id] = said
  }
  return { ...words, units }
}

const STEP_UP: Record<Level, Level> = { safe: 'mid', mid: 'high', high: 'high' }

/**
 * Reviews the change from `base` to `head`. Throws only when the review cannot be made at all: the checkout cannot be
 * read, or a code change gave the scan nothing to map (a wrong root or an unsupported language, never "nothing to
 * review"). Anything less is said in the story and in `problems`.
 */
export async function reviewChange(options: ReviewChangeOptions): Promise<ReviewChangeResult> {
  const { cwd, base, head, out } = options
  const config = options.config ?? DEFAULT_CONFIG
  const signal = options.signal ?? new AbortController().signal
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
  tracker.start('triage', 1, `triage: ${triage.totals.files} files sorted into ${triage.buckets.length} buckets; checking what replaces reading them`)
  triage = await checkBuckets(triage, repo, meta)
  save('triage.json', triage)
  tracker.end('triage')

  // 2. The map, by search.
  const mapped = filesToMap(triage)
  tracker.start('map-search', 1, `map-search: asking agentic-search for every changed definition in ${mapped.size} files`)
  const scanned = await (options.scan ?? runScan)({ cwd, base, head, signal })
  const scan: Scan = scanned.ok ? scanned.scan : { anchors: [], nodes: {}, edges: [], dangling: [], tests: [], files: [], coverage: { truncated: true, truncatedBy: 'failed', skippedAnchors: 0, unresolved: 0, notes: [] } }
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
  const nodes: ReviewNode[] = []
  for (const anchor of scan.anchors.filter((item) => mapped.has(item.path))) {
    const derived = deriveFacts({
      anchor,
      path: anchor.path,
      head: await linesAt(head, anchor.path),
      base: await linesAt(base, anchor.path),
      config,
      callers: callersOf(scan, anchor),
      callersComplete: anchor.callers?.complete ?? false,
    })
    const bucket = bucketOf(anchor.path)
    nodes.push({
      id: anchor.id,
      kind: kindOf(anchor),
      symbol: anchor.symbol,
      path: anchor.path,
      lines: [anchor.startLine, anchor.endLine],
      change: changeOf(anchor),
      changed_lines: anchor.changedLines,
      ...(anchor.language ? { language: anchor.language } : {}),
      entries: entriesOf(scan, anchor, config),
      facts: { ...derived.facts, proof: { value: 'unknown', evidence: 'tests have not run yet' } },
      extras: derived.extras,
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
  for (const [index, dangling] of scan.dangling.entries()) {
    const where = dangling.references.slice(0, 3).map((ref) => `${ref.path}:${ref.line}`).join(', ')
    nodes.push({
      id: `x${index + 1}`,
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
      extras: { broken: `${where} still ${dangling.references.length === 1 ? 'refers' : 'refer'} to ${dangling.symbol}, which this diff removes.` },
      conditions: [],
      hosts_condition: false,
      runs: [],
      sensitive: [],
      level: null,
      critical: false,
      findings: [{ rule: 'dangling-reference', text: `${dangling.symbol} is removed while ${where} still refers to it.`, by: 'search' }],
      watch: null,
      questions: [],
    })
  }
  const known = new Set(nodes.map((node) => node.id))
  const edges: GraphEdge[] = scan.edges.flatMap((edge) => {
    if (!edge.to || !known.has(edge.from) || !known.has(edge.to)) return []
    if (edge.relationship !== 'calls' && edge.relationship !== 'called_by' && edge.relationship !== 'enqueues') return []
    return [{ from: edge.from, to: edge.to, relationship: edge.relationship, resolution: edge.resolution, ...(edge.line ? { line: edge.line } : {}) }]
  })
  const graphOf = (list: ReviewNode[]): Graph => ({ schema: 'review-graph/1', range: triage.range, base, head, nodes: list, edges, coverage: { truncated: scan.coverage.truncated, notes: scan.coverage.notes } })
  save('graph.json', graphOf(nodes))

  // 3. Proof: the repository's own tests, at head and with each changed definition undone.
  // Definitions are proven by tests. What takes effect at load (constants, config, migrations) is decided by its operation.
  for (const node of nodes.filter((item) => item.kind === 'general' && item.change !== 'removed')) {
    node.facts.proof = { value: 'not-applicable', evidence: 'takes effect when the code loads or deploys: decided by what it does, not by a test' }
  }
  const provable = nodes.filter((node) => node.kind === 'function' && node.change !== 'removed' && node.facts.effect.value !== 'text')
  tracker.start('map-proof', provable.length, provable.length ? 'map-proof: finding how this repository runs its tests' : 'map-proof: nothing that runs needs proof')
  const runbook = detectRunbook(cwd, options.runbook)
  const changedTests = triage.buckets.filter((bucket) => bucket.kind === 'test').flatMap((bucket) => bucket.paths).filter((path) => existsSync(join(cwd, path)))
  const candidates: Record<string, TestCandidate[]> = {}
  for (const node of provable) {
    candidates[node.id] = await candidateTests({
      node,
      scan,
      changedTestPaths: changedTests,
      isLifecycleTest: (path) => isLifecycleTestPath(path, config),
      exists: (path) => existsSync(join(cwd, path)),
      read: (path) => readOr(join(cwd, path)),
    })
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
      const who = run.node ? nodes.find((node) => node.id === run.node)?.symbol ?? run.node : 'every candidate test'
      tracker.tick('map-proof', proved.size, `map-proof: ${run.kind} run for ${who}: ${run.tests.length} test ${run.tests.length === 1 ? 'file' : 'files'}, exit ${run.exit_code}`)
    },
  })
  if (proof.refused) problems.push(`Tests did not run: ${proof.refused}`)
  else if (!proof.clean) problems.push('The checkout was not clean after the test runs.')
  const proofEvents: RiskEvent[] = []
  for (const node of nodes) {
    if (node.kind === 'test') node.facts.proof = { value: 'not-applicable', evidence: 'a test itself' }
    else if (node.kind === 'function' && node.facts.effect.value === 'text') node.facts.proof = { value: 'not-applicable', evidence: 'only comments or whitespace changed' }
    const answer = proof.nodes[node.id]
    if (answer) node.facts.proof = { value: answer.value, evidence: answer.evidence }
    const mine = new Set((candidates[node.id] ?? []).map((candidate) => candidate.path))
    node.runs = proof.runs.filter((run) => run.node === node.id || (run.kind === 'baseline' && run.tests.some((test) => mine.has(test))))
    // A test that fails at head, before anything is changed, is a finding at high.
    for (const finding of proof.findings.filter((item) => [...mine].some((path) => item.text.includes(path)))) {
      node.findings.push(finding)
      proofEvents.push({ node: node.id, level: 'high', direction: 'up', aspect: 'failure', evidence: finding.text, rule: finding.rule, by: 'proof' })
    }
    // Rule 11 needs the condition on in a test that observes it, and the off path held by an unchanged test.
    if (node.facts.exposure.value === 'nobody-yet' && answer) {
      const flags = node.conditions.map((condition) => condition.name)
      const turnsOn = (path: string) => config.flags.testOn.some((pattern) => flags.some((flag) => (readOr(join(cwd, path)) ?? '').match(rx(pattern))?.groups?.flag === flag))
      node.extras.conditionOnProven = answer.observedBy.some(turnsOn)
      node.extras.offPathProven = (candidates[node.id] ?? []).some((candidate) => candidate.lifecycle && !candidate.changed && !answer.observedBy.includes(candidate.path))
    }
  }
  tracker.end('map-proof', proof.refused ? `map-proof: no test ran: ${proof.refused}` : undefined)
  save('graph.json', graphOf(nodes))

  // 4. The floor: a table over the four facts.
  tracker.start('risk-floor', nodes.length, `risk-floor: the floor table over ${nodes.length} nodes`)
  const before = structuredClone(nodes)
  let events: RiskEvent[] = [...proofEvents]
  let applied = applyRiskEvents(before, events)
  tracker.end('risk-floor')

  // Units as they stand, for the careful pass to read and name.
  const texts = new Map<string, string | null>()
  for (const path of new Set([...nodes.map((node) => node.path), ...Object.values(scan.nodes).map((node) => node.path)])) {
    texts.set(`head:${path}`, (await linesAt(head, path))?.join('\n') ?? null)
    texts.set(`base:${path}`, (await linesAt(base, path))?.join('\n') ?? null)
  }
  const source = (path: string, side: 'head' | 'base') => texts.get(`${side}:${path}`) ?? null
  const shape = (list: ReviewNode[]) => curate({ graph: graphOf(list), triage, diffs, source, scannedFiles: [...mapped] })
  let units = shape(applied.nodes)

  // 5. One careful pass: levels, questions, what to watch, claims, and the story's words.
  let words: StoryWords = meta.description.title ? { title: meta.description.title } : {}
  let storyBy: 'model' | 'host' = 'host'
  const assessed = applied.nodes.filter((node) => node.level?.current !== 'safe' || node.hosts_condition).length
  tracker.start('risk-model', model ? 1 : 0, model ? `risk-model: one careful pass over ${assessed} nodes that are mid, high or hold a new check` : 'risk-model: no model')
  if (!model) tracker.skip('risk-model', 'no model to ask: levels stay at their floors and the story is written from the facts')
  else {
    const request = reviewRequest({ triage, nodes: applied.nodes, units: units.units, code: Object.fromEntries(nodes.map((node) => [node.id, changedExcerpt(diffs, node)])) })
    problems.push(...request.cut.map((cut) => `Left out of the careful pass: ${cut}`))
    const text = await model({ pass: 'review', system: request.system, prompt: request.prompt, signal })
    if (text == null) tracker.skip('risk-model', 'the model gave no answer: levels stay at their floors')
    else {
      const answer = readReviewAnswer(text, { nodes: applied.nodes, units: units.units, claims: triage.claims })
      problems.push(...answer.problems.map((problem) => `From the careful pass: ${problem}`))
      events = [...events, ...answer.events]
      applied = applyRiskEvents(before, events)
      const settled = new Map(answer.claims.map((claim) => [claim.text, claim]))
      triage = { ...triage, claims: triage.claims.map((claim) => settled.get(claim.text) ?? claim) }
      const reshaped = shape(applied.nodes)
      const title = answer.words.title ?? words.title
      words = carryWords({ ...words, ...answer.words, ...(title ? { title } : {}) }, units.units, reshaped.units)
      units = reshaped
      storyBy = 'model'
      tracker.end('risk-model')
    }
  }
  save('risk-events.jsonl', events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : ''))
  save('triage.json', triage)

  // 6. The units, in the same shape at every level.
  tracker.start('shape', 1, `shape: ${units.units.length} units, the same shape at every level`)
  save('units.json', units)
  tracker.end('shape')

  // 7. The story.
  tracker.start('story', 1, 'story: writing the story from the units')
  let story = renderStory({ triage, graph: graphOf(applied.nodes), units, words })
  save('story.md', story)
  tracker.end('story')

  // 8. One blind check, then rules: raise one step, ask, or note that it was told badly. Never lower, never loop.
  const blind: BlindRecord = { ran: false, answer: null, check: null, actions: [], openQuestions: [] }
  if (!model) {
    blind.note = 'no model to ask'
    tracker.skip('blind-check', 'no model to ask')
  } else {
    tracker.start('blind-check', 1, 'blind-check: a fresh, cheap model reads only the story and the units')
    const checked = await runBlindCheck(model, { story, units: units.units }, signal)
    blind.answer = checked.answer
    blind.check = checked.check
    if (!checked.check) {
      blind.note = 'the checker gave no answer that could be read, so the check did not run'
      tracker.skip('blind-check', blind.note)
    } else {
      blind.ran = true
      const outcome = blindActions(checked.check, units.units)
      blind.actions = outcome.actions
      blind.openQuestions = outcome.openQuestions
      const old = units.units
      events = [...events, ...outcome.events.map((event) => ({ ...event, by: 'blind-check' }))]
      applied = applyRiskEvents(before, events)
      const reshaped = shape(applied.nodes)
      units = withBlindOutcome(reshaped, old, outcome)
      words = carryWords(words, old, units.units)
      story = renderStory({ triage, graph: graphOf(applied.nodes), units, words, blind: checked.check, actions: outcome.actions })
      save('units.json', units)
      save('story.md', story)
      save('risk-events.jsonl', events.map((event) => JSON.stringify(event)).join('\n') + '\n')
      tracker.end('blind-check')
    }
  }
  save('blind-check.json', blind)
  const graph = graphOf(applied.nodes)
  save('graph.json', graph)
  if (applied.rejected.length) save('rejected-events.json', applied.rejected)
  return { triage, graph, units, story, blind, rejected: applied.rejected, problems, progress: tracker.progress(), storyBy }
}

/**
 * What the blind check leaves on the reshaped units: its questions on the unit they were asked of, and the raises it
 * decided for units that carry no node (a checked bucket), done here because no event can carry them.
 */
function withBlindOutcome(units: Units, before: readonly Unit[], outcome: ReturnType<typeof blindActions>): Units {
  const keyOf = new Map(before.map((unit) => [unit.id, unitKey(unit)]))
  const answerOf = new Map(outcome.actions.map((action) => [action.unit, action.answer]))
  const next = units.units.map((unit) => {
    const asked = outcome.questions.filter((entry) => keyOf.get(entry.unit) === unitKey(unit)).map((entry) => entry.question)
    const questions: Question[] = [...unit.questions, ...asked.filter((question) => !unit.questions.some((have) => have.text === question.text))]
    const was = before.find((old) => unitKey(old) === unitKey(unit))
    const answer = was && !unit.nodes.length ? answerOf.get(was.id) : undefined
    // The same rules as for nodes: thin evidence raises one step; something unknown makes a safe unit mid.
    const level = answer === 'thin-evidence' ? STEP_UP[unit.level] : answer === 'unknown' && unit.level === 'safe' ? 'mid' : unit.level
    if (level !== unit.level) {
      const why = answer === 'thin-evidence' ? 'it could not be shown simply from the story' : 'something it needs is unknown'
      return { ...unit, level, questions, reading_minutes: Math.max(unit.reading_minutes, level === 'high' ? 2 : 1), why_level: [...unit.why_level, `Raised to ${level} by the blind check: ${why}.`] }
    }
    return { ...unit, questions }
  })
  return { ...units, units: next }
}

