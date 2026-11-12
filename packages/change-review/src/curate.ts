/**
 * Units: the things a reviewer decides on (FOUNDATION section 7, skills/node-curate). Pure code. It checks the map by
 * count and lookup, marks what cannot be trusted, and groups nodes by structure, never by level. Every unit is built
 * by one function, so every unit has the same fields in the same order whatever its level.
 */
import { lineKinds } from './comments.ts'
import type {
  Bucket, CodeShown, Effect, Exposure, Fact, Facts, FileDiff, Graph, GraphEdge, Hunk, Level, Proof, Question,
  ReviewNode, Triage, Undo, Unit, Units, Watch,
} from './types.ts'

// ───────────────────────── Checking the map ─────────────────────────

/** One thing wrong with the map. `node` is set when the problem belongs to a node. */
export interface MapProblem {
  rule: string
  text: string
  node?: string
}

const EFFECTS: readonly string[] = ['text', 'behaviour', 'interface', 'data', 'load']
const PROOFS: readonly string[] = ['lifecycle-observed', 'lifecycle', 'isolated', 'mocked', 'none', 'unknown', 'not-applicable']
const EXPOSURES: readonly string[] = ['nobody-yet', 'subset', 'everyone', 'at-load']
const UNDOS: readonly string[] = ['flag', 'flag-with-residue', 'rollback', 'none']
const WEAK_PROOF: readonly string[] = ['none', 'mocked', 'isolated', 'unknown']
const FACT_VALUES: Record<keyof Facts, readonly string[]> = { effect: EFFECTS, proof: PROOFS, exposure: EXPOSURES, undo: UNDOS }
const FACT_NAMES = ['effect', 'proof', 'exposure', 'undo'] as const

const RANK: Record<Level, number> = { safe: 0, mid: 1, high: 2 }
const levelOf = (node: ReviewNode): Level => (node.unverified ? 'high' : (node.level?.current ?? 'high'))
const worst = (levels: Level[]): Level => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'safe' as Level)

/**
 * Counts and lookups, not judgment: edge ends exist, the four facts hold listed values or `unknown`, no file sits in
 * two buckets (or in none, when the diff's files are given), every scanned file has a node, nothing is `safe` without a
 * test that ran, nothing is critical without being high, the scan was not cut short.
 */
export function checkMap(graph: Graph, triage: Triage, scannedFiles: readonly string[], diffPaths?: readonly string[]): MapProblem[] {
  const problems: MapProblem[] = []
  const ids = new Set(graph.nodes.map((node) => node.id))
  for (const edge of graph.edges) {
    for (const end of [edge.from, edge.to]) {
      if (ids.has(end)) continue
      const other = [edge.from, edge.to].find((id) => ids.has(id))
      problems.push({ rule: 'edge-endpoint', text: `edge ${edge.from} -> ${edge.to} names ${end}, which is not a node`, node: other })
    }
  }
  for (const node of graph.nodes) {
    for (const name of FACT_NAMES) {
      const fact = node.facts?.[name] as Fact | undefined
      if (!fact || !(FACT_VALUES[name].includes(fact.value) || fact.value === 'unknown')) {
        problems.push({ rule: 'fact-value', text: `${name} is ${fact ? `"${fact.value}"` : 'missing'}, not a listed value or unknown`, node: node.id })
      }
    }
    if (!node.level) problems.push({ rule: 'no-level', text: 'no level was set', node: node.id })
    if (node.level?.current === 'safe' && WEAK_PROOF.includes(node.facts?.proof?.value)) {
      problems.push({ rule: 'safe-without-proof', text: `safe with proof ${node.facts.proof.value}`, node: node.id })
    }
    if (node.critical && node.level?.current !== 'high') {
      problems.push({ rule: 'critical-not-high', text: `marked critical but ${node.level?.current ?? 'unlevelled'}, not high`, node: node.id })
    }
  }
  const seen = new Map<string, string>()
  for (const bucket of triage.buckets) {
    for (const path of bucket.paths) {
      const before = seen.get(path)
      if (before && before !== bucket.id) problems.push({ rule: 'file-in-two-buckets', text: `${path} is in buckets ${before} and ${bucket.id}` })
      seen.set(path, bucket.id)
    }
  }
  for (const path of diffPaths ?? []) {
    if (!seen.has(path)) problems.push({ rule: 'file-in-no-bucket', text: `${path} is in the diff but in no bucket` })
  }
  const nodePaths = new Set(graph.nodes.map((node) => node.path))
  for (const path of scannedFiles) {
    if (!nodePaths.has(path)) problems.push({ rule: 'scanned-file-without-node', text: `${path} was scanned but has no node` })
  }
  if (graph.coverage.truncated) problems.push({ rule: 'scan-truncated', text: 'the scan was cut short, so nodes may be missing' })
  return problems
}

/** A node with a problem gets `unverified` (the reasons) and is treated as high. Nothing is dropped; the input is left alone. */
export function markUnverified(graph: Graph, problems: readonly MapProblem[]): Graph {
  const reasons = new Map<string, string[]>()
  for (const problem of problems) {
    if (problem.node) reasons.set(problem.node, [...(reasons.get(problem.node) ?? []), problem.text])
  }
  return { ...graph, nodes: graph.nodes.map((node) => (reasons.has(node.id) ? { ...node, unverified: reasons.get(node.id)!.join('; ') } : node)) }
}

// ───────────────────────── The change as lines ─────────────────────────

/** A trimmed piece of a diff and the lines it covers. */
interface Excerpt {
  lines: string[]
  /** First and last line number of the side shown, when the excerpt has any. */
  range?: [number, number]
  /** Lines left out to stay in budget. */
  cut: number
}

const CONTEXT = 3

/**
 * The part of a file's hunks that falls inside lines `start` to `end` on one side: the head side for a definition that
 * exists at head, the base side for a removed one. Context is trimmed to a few lines around each change.
 */
function excerptOf(file: FileDiff | undefined, start: number, end: number, side: 'new' | 'old', budget: number): Excerpt {
  const picked: { text: string; changed: boolean; number?: number }[] = []
  for (const hunk of file?.hunks ?? []) {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    for (const line of hunk.lines) {
      const mark = line[0]
      if (mark === '\\') continue
      const here = side === 'new' ? newLine : oldLine
      const own = mark === ' ' || (side === 'new' ? mark === '+' : mark === '-')
      const inside = own ? here >= start && here <= end : here >= start && here <= end + 1
      if (inside) picked.push({ text: line, changed: mark !== ' ', number: own ? here : undefined })
      if (mark !== '+') oldLine++
      if (mark !== '-') newLine++
    }
  }
  const keep = picked.map((_, index) => picked.slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1).some((line) => line.changed))
  const kept = picked.filter((_, index) => keep[index])
  if (!kept.some((line) => line.changed)) return { lines: [], cut: 0 }
  const shown = kept.slice(0, budget)
  const numbers = shown.map((line) => line.number).filter((value): value is number => value !== undefined)
  return { lines: shown.map((line) => line.text), range: numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : undefined, cut: kept.length - shown.length }
}

const nodeExcerpt = (diffs: readonly FileDiff[], node: ReviewNode, budget: number) =>
  excerptOf(diffs.find((file) => file.path === node.path), node.lines[0], node.lines[1], node.change === 'removed' ? 'old' : 'new', budget)

/** Lines of a file's text as unchanged context. */
function plainLines(text: string, from: number, to: number): Excerpt {
  const all = text.split('\n')
  const first = Math.max(1, from)
  const last = Math.min(all.length, to)
  if (last < first) return { lines: [], cut: 0 }
  return { lines: all.slice(first - 1, last).map((line) => ` ${line}`), range: [first, last], cut: 0 }
}

// ───────────────────────── The path ─────────────────────────

const walks = (edge: GraphEdge) => edge.relationship === 'calls' || edge.relationship === 'enqueues'

/** [caller, callee] pairs, whichever way the edge was written. */
function callPairs(graph: Graph): { from: string; to: string; line?: number }[] {
  const pairs: { from: string; to: string; line?: number }[] = []
  for (const edge of graph.edges) {
    if (walks(edge)) pairs.push({ from: edge.from, to: edge.to, line: edge.line })
    else if (edge.relationship === 'called_by') pairs.push({ from: edge.to, to: edge.from, line: edge.line })
  }
  return pairs
}

/** A node is on the request path when an entry point is above it or the graph links it to something that calls or is called. */
export function isOnPath(graph: Graph, node: ReviewNode): boolean {
  return node.entries.length > 0 || callPairs(graph).some((pair) => pair.from === node.id || pair.to === node.id)
}

/** Distance from the nearest node nothing calls: entry first. */
function depths(graph: Graph): Map<string, number> {
  const pairs = callPairs(graph)
  const calls = new Map<string, string[]>()
  const called = new Set<string>()
  for (const pair of pairs) {
    calls.set(pair.from, [...(calls.get(pair.from) ?? []), pair.to])
    called.add(pair.to)
  }
  const depth = new Map<string, number>()
  const walk = (root: string) => {
    const queue: [string, number][] = [[root, 0]]
    while (queue.length) {
      const [id, d] = queue.shift()!
      if (depth.has(id)) continue
      depth.set(id, d)
      for (const next of calls.get(id) ?? []) queue.push([next, d + 1])
    }
  }
  const ids = graph.nodes.map((node) => node.id).sort()
  for (const id of ids) if (!called.has(id)) walk(id)
  for (const id of ids) if (!depth.has(id)) walk(id)
  return depth
}

// ───────────────────────── Titles, places, words ─────────────────────────

const short = (symbol: string) => symbol.split(/#|::|\./).filter(Boolean).pop() ?? symbol
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
const BEHAVES: Record<Effect, string> = {
  text: 'changes only text',
  behaviour: 'changes behaviour',
  interface: 'changes its interface',
  data: 'changes data it writes, sends or keeps',
  load: 'changes what runs at load',
}
/** Who runs it, in a title, only where that tells something: with no condition in front of it, a change runs for everyone, as most do. */
const AUDIENCE: Record<Exposure, string> = { 'nobody-yet': ' for nobody yet', subset: ' for a subset', everyone: '', 'at-load': ' at load' }
const PROVEN: Record<Proof, string> = {
  'lifecycle-observed': 'a test added with it goes through a request to it',
  lifecycle: 'a test goes through a request to it',
  isolated: 'tests that call it directly fail without the change',
  mocked: 'its test mocks it',
  none: 'no test shows it',
  unknown: 'its tests could not run',
  'not-applicable': '',
}

const isBroken = (node: ReviewNode) => Boolean(node.extras?.broken) || node.findings.some((finding) => finding.rule === 'dangling-reference')

/** The title of a single node, a claim built from its facts. No model words. */
function titleOf(node: ReviewNode): string {
  const name = `\`${short(node.symbol)}\``
  if (node.unverified) return `${name} has an inconsistent map entry, so it is treated as high`
  if (isBroken(node)) return `${name} leaves a broken reference: ${node.extras?.broken ?? 'something that remains refers to it'}`
  const condition = node.conditions.find((item) => item.added)
  if (node.hosts_condition) return `The new check on \`${condition?.name ?? 'a condition'}\` in ${name} runs for everyone`
  if (isSchema(node)) return `${name} changes the schema${node.extras?.additiveSchema ? ', only by adding' : ''}`
  if (node.extras?.typeOnly) {
    const typeChange = { added: 'is a new type', removed: 'is a removed type' }[node.change as string] ?? 'changes a type'
    return `${name} ${typeChange}, erased before the code runs`
  }
  const facts = normalizedFacts(node)
  const proof = PROVEN[facts.proof.value as Proof] ?? 'no test shows it'
  let verb = BEHAVES[facts.effect.value as Effect] ?? 'changes'
  if (node.change === 'removed') verb = 'is removed'
  else if (node.change === 'added') verb = `is new and ${BEHAVES[facts.effect.value as Effect] ?? 'changes behaviour'}`
  // "changes what runs at load" already says when; "at load" again would say it twice.
  const audience = facts.effect.value === 'load' && facts.exposure.value === 'at-load' ? '' : (AUDIENCE[facts.exposure.value as Exposure] ?? '')
  return `${name} ${verb}${audience}${proof ? `, and ${proof}` : ''}`
}

/** "a", "a and b", "a, b and c". */
const listed = (items: readonly string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

/** Where a unit sits on the way a request takes, in one short sentence: what reaches it, or that nothing named does. */
function whereOf(node: ReviewNode, onPath: boolean): string {
  const condition = node.hosts_condition ? ' It holds a new check that runs for everyone.' : ''
  // An entry point once, by its name: the kind it is in brackets is data, not words.
  const entries = [...new Set(node.entries.map((entry) => entry.replace(/ \([\w -]+\)$/, '')))]
  if (entries.length) return `Reached from ${listed(entries.slice(0, 3))}${entries.length > 3 ? ` and ${entries.length - 3} more` : ''}.${condition}`
  if (onPath) return `Other changed code calls it. No route, job or command was found that leads to it.${condition}`
  const load = node.facts?.effect?.value === 'load' || node.facts?.exposure?.value === 'at-load'
  return `${load ? 'Takes effect when the file loads.' : 'No route, job or command was found that leads to it.'}${condition}`
}

/** What changed in a unit, in one short sentence: how many lines, in which definition. */
function whatOf(node: ReviewNode, excerpt: Excerpt): string {
  const name = `\`${short(node.symbol)}\``
  const count = plural(node.changed_lines.length || excerpt.lines.filter((line) => line[0] === '-' || line[0] === '+').length, 'line')
  const said = node.change === 'added' ? `Adds ${name}, ${count}.` : node.change === 'removed' ? `Removes ${name}.` : `Changes ${count} in ${name}.`
  return `${said}${node.hosts_condition ? ' It adds a check that runs for everyone.' : ''}`
}

// ───────────────────────── Nodes, buckets, special cases ─────────────────────────

function normalizedFacts(node: ReviewNode): Facts {
  const missing = { value: 'unknown', evidence: 'not recorded' }
  return {
    effect: node.facts?.effect ?? (missing as Fact<Effect>),
    proof: node.facts?.proof ?? (missing as Fact<Proof>),
    exposure: node.facts?.exposure ?? (missing as Fact<Exposure>),
    undo: node.facts?.undo ?? (missing as Fact<Undo>),
  }
}

const bucketOfNode = (triage: Triage, node: ReviewNode): Bucket | undefined =>
  triage.buckets.find((bucket) => bucket.id === node.bucket) ?? triage.buckets.find((bucket) => bucket.paths.includes(node.path))

const isSchema = (node: ReviewNode) => node.extras?.additiveSchema !== undefined

/** Nodes that are always a unit of their own (node-curate): critical, broken reference, schema change, new condition check, unverified. */
function standsAlone(node: ReviewNode, bucket: Bucket | undefined): boolean {
  return node.critical || isBroken(node) || isSchema(node) || bucket?.kind === 'migration' || node.hosts_condition || Boolean(node.unverified)
}

/** Whether a triage bucket becomes a unit of its own rather than being read through nodes or only counted. */
const bucketIsUnit = (bucket: Bucket) =>
  ['sample', 'removal', 'parity'].includes(bucket.treatment) || bucket.kind === 'generated' || bucket.change === 'renamed'

interface BucketVerdict {
  level: Level
  critical: boolean
  rule: number
  why: string[]
  would: { text: string; level: Level }[]
}

/** What a bucket's checks say about it (floor rules 1 and 2). */
function judgeBucket(bucket: Bucket): BucketVerdict {
  const checks = bucket.checks ?? []
  const outcomeOf = (check: NonNullable<Bucket['checks']>[number]) => {
    if (check.passed === null) return 'could not run'
    return check.passed ? 'passed' : 'failed'
  }
  const why = checks.map((check) => `Check "${check.name}": ${outcomeOf(check)}. ${check.detail}`)
  const breaking = checks.filter((check) => check.passed === false && check.breaks)
  const would = checks
    .filter((check) => check.passed !== true)
    .map((check) => ({
      text: check.passed === null ? `Make the check "${check.name}" run.` : `Fix what "${check.name}" found: ${check.detail}`,
      level: 'safe' as Level,
    }))
  if (breaking.length) return { level: 'high', critical: true, rule: 1, why: ['A check found something broken or missing.', ...why], would }
  if (checks.some((check) => check.passed === null)) return { level: 'high', critical: false, rule: 3, why: ['A check could not run, so the bucket is treated as the worse case.', ...why], would }
  if (checks.some((check) => check.passed === false)) return { level: 'mid', critical: false, rule: 8, why: ['A check failed without breaking anything.', ...why], would }
  if (checks.length) return { level: 'safe', critical: false, rule: 2, why: ['Every check passed.', ...why], would }
  const mild = bucket.kind === 'generated' || bucket.kind === 'docs' || bucket.kind === 'dependency' || bucket.change === 'renamed'
  return { level: mild ? 'mid' : 'high', critical: false, rule: 3, why: ['No check ran for this bucket, so nothing shows it is complete.'], would }
}

// ───────────────────────── Building units ─────────────────────────

const MINUTES: Record<Level, number> = { high: 2, mid: 1, safe: 0.5 }
const CODE_BUDGET = 30
const SIDE_BUDGET = 10
const SITES_SHOWN = 3
const MECHANICAL_MIN = 4
const MAX_UNITS = 9

export interface CurateInput {
  graph: Graph
  triage: Triage
  diffs: readonly FileDiff[]
  /** A file's full text at head or base, for the one caller or callee shown. */
  source?: (path: string, side: 'head' | 'base') => string | null
  /** Files triage marked `scan`, for the "every scanned file has a node" check. */
  scannedFiles?: readonly string[]
}

/** A unit before ids and parts, with what ordering needs. */
interface Draft {
  unit: Omit<Unit, 'id'>
  stop: number
  entry: string
  sensitive: number
  path: string
  line: number
}

const shown = (path: string, why: string, excerpt: Excerpt): CodeShown => ({
  path,
  ...(excerpt.range ? { lines: excerpt.range } : {}),
  why: excerpt.cut ? `${why} (first ${excerpt.lines.length} lines; ${excerpt.cut} more not shown)` : why,
  diff: excerpt.lines.join('\n'),
})

/** The caller the level rests on: the one with the weakest proof; else the first callee. Never a test, never in the same unit. */
function neighbourOf(graph: Graph, node: ReviewNode, inside: Set<string>) {
  const byId = new Map(graph.nodes.map((item) => [item.id, item]))
  const pairs = callPairs(graph)
  const weak = (item: ReviewNode) => PROOFS.indexOf(item.facts?.proof?.value ?? 'unknown')
  const usable = (id: string) => {
    const item = byId.get(id)
    return item && item.kind !== 'test' && !inside.has(id) ? item : undefined
  }
  const callers = pairs
    .filter((pair) => pair.to === node.id && usable(pair.from))
    .map((pair) => ({ node: usable(pair.from)!, line: pair.line, role: 'caller' as const }))
    .sort((a, b) => weak(a.node) - weak(b.node) || a.node.id.localeCompare(b.node.id))
  if (callers[0]) return callers[0]
  const callee = pairs.find((pair) => pair.from === node.id && usable(pair.to))
  return callee ? { node: usable(callee.to)!, line: callee.line, role: 'callee' as const } : undefined
}

function neighbourCode(input: CurateInput, owner: ReviewNode, inside: Set<string>): CodeShown | undefined {
  const found = neighbourOf(input.graph, owner, inside)
  if (!found) return undefined
  const { node, line, role } = found
  const why = `the ${role} \`${short(node.symbol)}\``
  const changed = nodeExcerpt(input.diffs, node, SIDE_BUDGET)
  if (changed.lines.length) return shown(node.path, why, changed)
  const text = input.source?.(node.path, node.change === 'removed' ? 'base' : 'head')
  if (!text) return undefined
  const lineInNode = line && line >= node.lines[0] && line <= node.lines[1]
  const around = lineInNode
    ? plainLines(text, line - 2, line + 2)
    : plainLines(text, node.lines[0], Math.min(node.lines[1], node.lines[0] + SIDE_BUDGET - 1))
  return around.lines.length ? shown(node.path, why, around) : undefined
}

/** The node's own changed lines; when the diff has none for it, the lines around its first changed line from the source. */
function ownCode(input: CurateInput, node: ReviewNode, budget: number, why: string): CodeShown {
  const found = nodeExcerpt(input.diffs, node, budget)
  if (found.lines.length) return shown(node.path, why, found)
  const first = node.changed_lines[0] ?? node.lines[0]
  const text = input.source?.(node.path, node.change === 'removed' ? 'base' : 'head')
  const fallback = text ? plainLines(text, first - 2, first + 2) : { lines: [], cut: 0 }
  if (!fallback.lines.length) return { path: node.path, why: `${why}: no diff text or source was available`, diff: '' }
  return shown(node.path, `${why}, as unchanged context: no diff text was available`, fallback)
}

function mergeWatch(nodes: ReviewNode[]): Watch {
  const signals = new Map<string, Watch['signals'][number]>()
  const gaps = new Set<string>()
  for (const node of nodes) {
    for (const signal of node.watch?.signals ?? []) signals.set(`${signal.name}@${signal.at}`, signal)
    for (const gap of node.watch?.gaps ?? []) gaps.add(gap)
  }
  if (!signals.size && !gaps.size) gaps.add('no watch information was recorded for this unit')
  const undo = nodes[0]?.watch?.undo
  return { signals: [...signals.values()], gaps: [...gaps], ...(undo ? { undo } : {}) }
}

function mergeQuestions(nodes: ReviewNode[]): Question[] {
  const out = new Map<string, Question>()
  for (const node of nodes) {
    for (const question of node.questions) out.set(question.text, question)
    if (node.unverified) out.set(`map:${node.id}`, { text: `Is the map entry for \`${short(node.symbol)}\` right?`, why: node.unverified })
  }
  return [...out.values()]
}

function whyOf(nodes: ReviewNode[]): string[] {
  const owner = nodes[0]!
  const lines: string[] = []
  if (owner.unverified) lines.push(`Unverified: ${owner.unverified}. Treated as high.`)
  const base = owner.level?.why ?? []
  lines.push(...base)
  for (const finding of owner.findings) if (!lines.includes(finding.text)) lines.push(finding.text)
  return lines
}

/** One unit from its nodes; the first node is the owner whose facts, reasons and suggestions the unit shows. */
function nodeDraft(input: CurateInput, nodes: ReviewNode[], grouping: Unit['grouping'], context: Context): Draft {
  const owner = nodes[0]!
  const level = worst(nodes.map(levelOf))
  const names = new Set(nodes.map((node) => node.id))
  const critical = level === 'high' && nodes.some((node) => node.critical)
  const memberWhat = (node: ReviewNode) => {
    if (node === owner && grouping === 'definition-with-helpers') return 'the definition'
    return grouping === 'mechanical' ? 'the same change as the others' : 'a helper changed with it'
  }
  const members = nodes.map((node) => ({ node: node.id, name: short(node.symbol), what: memberWhat(node) }))
  let code: CodeShown[]
  let title = titleOf(owner)
  let what: string
  let why = whyOf(nodes)
  const own = nodeExcerpt(input.diffs, owner, CODE_BUDGET)
  if (grouping === 'mechanical') {
    const sites = nodes.slice(0, SITES_SHOWN)
    code = sites.map((node) => ownCode(input, node, 8, `site \`${short(node.symbol)}\``))
    const list = nodes.slice(0, 2).map((node) => `\`${short(node.symbol)}\``).join(', ')
    title = `${nodes.length} sites change the same way: ${list} and ${nodes.length - 2} more`
    what = `The same change is repeated at ${nodes.length} sites. ${sites.length} are shown; the others differ only in the name.`
    why = [...whyOf([owner]), `Every site has the same hunk once its own name is set aside.`]
  } else if (grouping === 'definition-with-helpers') {
    const helpers = nodes.slice(1)
    code = [shown(owner.path, 'the changed lines', own.lines.length ? own : { lines: [], cut: 0 })]
    if (!own.lines.length) code = [ownCode(input, owner, CODE_BUDGET, 'the changed lines')]
    const budget = Math.max(6, Math.floor(CODE_BUDGET / (helpers.length + 1)))
    for (const helper of helpers.slice(0, 3)) code.push(ownCode(input, helper, budget, `the helper \`${short(helper.symbol)}\``))
    const neighbour = neighbourCode(input, owner, names)
    if (neighbour) code.push(neighbour)
    title = `${titleOf(owner)}, with ${plural(helpers.length, 'helper')} changed alongside`
    what = `${whatOf(owner, own)} Changed with it, and reached only through it: ${helpers.map((helper) => `\`${short(helper.symbol)}\``).join(', ')}.`
  } else {
    code = [ownCode(input, owner, CODE_BUDGET, 'the changed lines')]
    const neighbour = neighbourCode(input, owner, names)
    if (neighbour) code.push(neighbour)
    what = whatOf(owner, own)
  }
  const onPath = isOnPath(input.graph, owner)
  const unverifiedNode = nodes.find((node) => node.unverified)
  const depth = context.depth.get(owner.id) ?? 0
  const unit: Omit<Unit, 'id'> = {
    title,
    level,
    critical,
    nodes: nodes.map((node) => node.id),
    ...(owner.bucket ? { buckets: [owner.bucket] } : {}),
    ...(grouping !== 'single' ? { represents: { nodes: nodes.length } } : {}),
    grouping,
    story_order: onPath ? depth : OFF_PATH,
    where: whereOf(owner, onPath),
    what,
    code,
    facts: normalizedFacts(owner),
    why_level: why,
    would_change: owner.level?.if ?? [],
    watch: level === 'safe' ? 'not assessed' : mergeWatch(nodes),
    questions: mergeQuestions(nodes),
    ...(grouping !== 'single' ? { members } : {}),
    ...(unverifiedNode ? { unverified: unverifiedNode.unverified } : {}),
    reading_minutes: MINUTES[level],
  }
  return {
    unit,
    stop: onPath ? depth : OFF_PATH,
    entry: owner.entries[0] ?? '',
    sensitive: nodes.reduce((sum, node) => sum + node.sensitive.length, 0),
    path: owner.path,
    line: owner.lines[0],
  }
}

const OFF_PATH = 1_000_000
const BUCKET_STOP = 2_000_000

interface Context {
  depth: Map<string, number>
}

const KIND_EFFECT: Partial<Record<Bucket['kind'], Effect>> = {
  translation: 'text',
  generated: 'text',
  docs: 'text',
  migration: 'load',
  config: 'load',
  dependency: 'load',
}

/** A mechanical bucket's verdict: the worst level of the sites that were read, with their reasons. */
function sitesVerdict(bucket: Bucket, sites: readonly ReviewNode[], level: Level): BucketVerdict {
  const read = bucket.sample?.read.length ?? sites.length
  const would = sites.flatMap((node) => node.level?.if ?? []).filter((item, index, all) => all.findIndex((other) => other.text === item.text) === index)
  const worstSites = sites.filter((node) => levelOf(node) === level)
  return {
    level,
    critical: false,
    rule: worstSites[0]?.level?.rule ?? 12,
    why: [
      `The same edit in ${plural(bucket.files, 'file')}: ${read} read, and the worst of them is ${level}.`,
      ...worstSites.flatMap((node) => node.level?.why.slice(0, 1) ?? []),
    ],
    would,
  }
}

function bucketDraft(input: CurateInput, bucket: Bucket, absorbed: ReviewNode[], sitesLevel?: Level): Draft {
  const verdict = sitesLevel ? sitesVerdict(bucket, absorbed, sitesLevel) : judgeBucket(bucket)
  const lead = sitesLevel ? absorbed.find((node) => levelOf(node) === sitesLevel) : undefined
  const removal = bucket.treatment === 'removal' || bucket.change === 'deleted' || bucket.change === 'renamed'
  const effect: Effect = removal ? 'interface' : (KIND_EFFECT[bucket.kind] ?? 'behaviour')
  const failed = (bucket.checks ?? []).filter((check) => check.passed === false).length
  let outcome = 'and every check passed'
  if (!bucket.checks?.length) outcome = 'and no check ran'
  else if (failed) outcome = `and ${plural(failed, 'check')} failed`
  else if (bucket.checks.some((check) => check.passed === null)) outcome = 'and a check could not run'
  const readNote =
    bucket.treatment === 'sample' && bucket.sample
      ? `${bucket.sample.read.length} read, ${bucket.sample.trusted} trusted on the checks.`
      : 'Checked rather than read line by line.'
  const what = `${plural(bucket.files, 'file')} in \`${bucket.folder}\` (${bucket.kind}, ${bucket.change}): ${bucket.added} lines added, ${bucket.deleted} removed. ${readNote}`
  const sample = (bucket.sample?.read.length ? bucket.sample.read : bucket.paths).slice(0, 2)
  const code: CodeShown[] = []
  for (const path of sample) {
    const file = input.diffs.find((item) => item.path === path)
    const hunk: Hunk | undefined = file?.hunks[0]
    if (hunk) {
      const why = bucket.sample?.read.includes(path) ? 'a file that was read' : 'the first hunk'
      const excerpt: Excerpt = {
        lines: hunk.lines.slice(0, 12),
        range: [hunk.newStart, hunk.newStart + hunk.newLines - 1],
        cut: Math.max(0, hunk.lines.length - 12),
      }
      code.push(shown(path, why, excerpt))
    }
  }
  if (!code.length) {
    const mark = bucket.change === 'deleted' ? '-' : bucket.change === 'added' ? '+' : ' '
    const cut = Math.max(0, bucket.paths.length - 10)
    code.push({
      path: bucket.folder,
      why: `the files in this bucket${cut ? ` (first 10; ${cut} more not shown)` : ''}`,
      diff: bucket.paths
        .slice(0, 10)
        .map((path) => `${mark}${path}`)
        .join('\n'),
    })
  }
  const unit: Omit<Unit, 'id'> = {
    title: `\`${bucket.folder}\`: ${plural(bucket.files, bucket.kind === 'code' ? 'file' : `${bucket.kind} file`)} ${removal ? 'removed or moved' : 'changed'}, ${outcome}`,
    level: verdict.level,
    critical: verdict.critical,
    nodes: absorbed.map((node) => node.id),
    buckets: [bucket.id],
    represents: { files: bucket.files, lines: bucket.added + bucket.deleted, ...(absorbed.length ? { nodes: absorbed.length } : {}) },
    grouping: 'bucket',
    story_order: BUCKET_STOP,
    where: `${bucket.kind.charAt(0).toUpperCase()}${bucket.kind.slice(1)} files in \`${bucket.folder}\`, checked by counts and lookups.`,
    what,
    code,
    facts: lead
      ? normalizedFacts(lead)
      : {
          effect: { value: effect, evidence: bucket.why },
          proof: { value: 'not-applicable', evidence: 'decided by the bucket checks, not by a test' },
          exposure: {
            value: bucket.kind === 'migration' || bucket.kind === 'config' || bucket.kind === 'dependency' ? 'at-load' : 'everyone',
            evidence: `${bucket.kind} files take effect on their own, not through a call`,
          },
          undo: { value: 'rollback', evidence: 'reverting the deploy restores them' },
        },
    why_level: verdict.why,
    would_change: verdict.would,
    watch: verdict.level === 'safe' ? 'not assessed' : { signals: [], gaps: ['no signal was assessed for this bucket'] },
    questions: [],
    reading_minutes: MINUTES[verdict.level],
  }
  return { unit, stop: BUCKET_STOP, entry: '', sensitive: 0, path: bucket.folder, line: 0 }
}

/** Whether a file's diff changes a line that runs: one added at head or removed at base that is not blank or only a comment. A line that cannot be read counts as one that runs. */
function changesCode(input: CurateInput, file: FileDiff): boolean {
  const kindsAt = (side: 'head' | 'base') => {
    const text = input.source?.(side === 'base' ? (file.oldPath ?? file.path) : file.path, side)
    return text == null ? null : lineKinds(file.path, text)
  }
  const [head, base] = [kindsAt('head'), kindsAt('base')]
  const runs = (kinds: ReturnType<typeof kindsAt>, at: number) => {
    const kind = kinds?.[at - 1]
    return kind !== 'blank' && kind !== 'comment'
  }
  for (const hunk of file.hunks) {
    let [oldLine, newLine] = [hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart, hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart]
    for (const line of hunk.lines) {
      if (line[0] === '+') {
        if (runs(head, newLine)) return true
        newLine += 1
      } else if (line[0] === '-') {
        if (runs(base, oldLine)) return true
        oldLine += 1
      } else {
        oldLine += 1
        newLine += 1
      }
    }
  }
  return false
}

/**
 * A code file the scan was given and found no definition in, though lines that run changed in it: a script with no
 * file ending, a language the search tool does not read. Nothing in it was checked, so it is a unit of its own that
 * says so, at high (FOUNDATION section 7: a failure to report, never "nothing to review").
 */
function unreadDraft(bucket: Bucket, file: FileDiff): Draft {
  const path = file.path
  const changed = file.hunks.flatMap((hunk) => hunk.lines)
  const [added, removed] = [changed.filter((line) => line[0] === '+').length, changed.filter((line) => line[0] === '-').length]
  const hunk = file.hunks[0]!
  const excerpt: Excerpt = { lines: hunk.lines.slice(0, 12), range: [hunk.newStart, hunk.newStart + Math.max(hunk.newLines, 1) - 1], cut: Math.max(0, changed.length - 12) }
  const unit: Omit<Unit, 'id'> = {
    title: `\`${path}\` was not checked: the search tool found no definition in it`,
    level: 'high',
    critical: false,
    nodes: [],
    buckets: [bucket.id],
    represents: { files: 1, lines: added + removed },
    grouping: 'bucket',
    story_order: BUCKET_STOP,
    where: `In \`${bucket.folder}\`. What calls it, and what it calls, was not looked for.`,
    what: `${plural(added, 'line')} added and ${removed} removed that this review did not read. Read the file yourself.`,
    code: [shown(path, 'the first changed lines', excerpt)],
    facts: {
      effect: { value: 'behaviour', evidence: 'lines that run changed, and none was read as part of a definition' },
      proof: { value: 'unknown', evidence: 'no definition was found to run tests against' },
      exposure: { value: 'everyone', evidence: 'no condition in front of it was looked for' },
      undo: { value: 'rollback', evidence: 'reverting the deploy restores the file' },
    },
    why_level: ['The search tool found no definition in this file, so nothing in it was checked: none of the four facts, and no test was run for it.'],
    would_change: [{ text: 'Give the file a form the search tool reads, such as the file ending of its language, and review again', level: 'mid' }],
    watch: { signals: [], gaps: ['nothing in this file was assessed'] },
    questions: [],
    unverified: `the search tool found no definition in ${path}`,
    reading_minutes: MINUTES.high,
  }
  return { unit, stop: BUCKET_STOP, entry: '', sensitive: 0, path, line: 0 }
}

// ───────────────────────── Grouping ─────────────────────────

/** The sole caller of a node in the graph, or undefined when it has none or several. */
function soleCaller(graph: Graph, node: ReviewNode): string | undefined {
  if (node.callers && (!node.callers.complete || node.callers.total > 1)) return undefined
  const callers = new Set(callPairs(graph).filter((pair) => pair.to === node.id).map((pair) => pair.from))
  return callers.size === 1 ? [...callers][0] : undefined
}

/** Helpers by owner: same file, only caller is the owner, same level, nothing that stands alone. Chains collapse into the root. */
function helpersByOwner(input: CurateInput, nodes: ReviewNode[]): Map<string, ReviewNode[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const parent = new Map<string, string>()
  for (const node of nodes) {
    const caller = soleCaller(input.graph, node)
    const owner = caller ? byId.get(caller) : undefined
    if (!owner || owner.path !== node.path || node.kind !== 'function' || owner.kind !== 'function') continue
    if (standsAlone(node, bucketOfNode(input.triage, node)) || levelOf(owner) !== levelOf(node)) continue
    parent.set(node.id, owner.id)
  }
  const root = (id: string, seen = new Set<string>()): string => {
    const up = parent.get(id)
    return up && !seen.has(up) ? root(up, seen.add(id)) : id
  }
  const groups = new Map<string, ReviewNode[]>()
  for (const node of nodes) {
    const top = root(node.id)
    if (top !== node.id) groups.set(top, [...(groups.get(top) ?? []), node])
  }
  return groups
}

/** A node's changed lines with its own name set aside, to tell whether sites changed the same way. */
function signature(input: CurateInput, node: ReviewNode): string {
  const lines = nodeExcerpt(input.diffs, node, 200).lines.filter((line) => line[0] === '+' || line[0] === '-')
  const name = short(node.symbol).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return lines.map((line) => line.replace(new RegExp(`(?<![A-Za-z0-9])${name}(?![A-Za-z0-9])`, 'g'), '$S')).join('\n')
}

const byPosition = (a: ReviewNode, b: ReviewNode) => a.path.localeCompare(b.path) || a.lines[0] - b.lines[0]

// ───────────────────────── curate ─────────────────────────

/**
 * Units from the map. Throws `scan failure` when a code change has no nodes: that is a wrong root or an unsupported
 * language, never "nothing to review". Never drops a node and never merges units to fit nine.
 */
export function curate(input: CurateInput): Units {
  const graph = markUnverified(input.graph, checkMap(input.graph, input.triage, input.scannedFiles ?? []))
  const work: CurateInput = { ...input, graph }
  const code = graph.nodes.filter((node) => node.kind !== 'test')
  const scanned = input.triage.buckets.some((bucket) => bucket.kind === 'code' && (bucket.treatment === 'scan' || bucket.treatment === 'parity'))
  if (!code.length && scanned) throw new Error('scan failure: the change has code but the scan produced no nodes (wrong root or unsupported language)')

  const context: Context = { depth: depths(graph) }
  const drafts: Draft[] = []
  const claimed = new Set<string>()

  // Buckets that are units of their own take the nodes that sit in them at the bucket's level.
  const covered = new Set(code.map((node) => node.path))
  for (const bucket of input.triage.buckets) {
    const fallback = bucket.treatment === 'scan' && bucket.kind !== 'code' && bucket.kind !== 'test' && !bucket.paths.some((path) => covered.has(path))
    if (bucket.treatment === 'tests' || bucket.kind === 'test') continue
    if (!(bucketIsUnit(bucket) || fallback)) continue
    const inside = code.filter((node) => bucketOfNode(input.triage, node)?.id === bucket.id && !standsAlone(node, bucket))
    // Identical edits are judged by the sites that were read: the unit takes their worst level and all of them.
    const sitesRead = bucket.treatment === 'sample' && bucket.kind === 'code' && inside.length > 0
    const level = sitesRead ? worst(inside.map(levelOf)) : judgeBucket(bucket).level
    const absorbed = sitesRead ? inside : inside.filter((node) => levelOf(node) === level)
    for (const node of absorbed) claimed.add(node.id)
    drafts.push(bucketDraft(work, bucket, absorbed, sitesRead ? level : undefined))
  }
  // A code file with no node, and lines that run changed in it: said, never left out.
  const mapped = new Set(graph.nodes.map((node) => node.path))
  for (const path of input.scannedFiles ?? []) {
    const bucket = input.triage.buckets.find((item) => item.paths.includes(path))
    const file = input.diffs.find((item) => item.path === path)
    if (mapped.has(path) || bucket?.kind !== 'code' || bucket.treatment !== 'scan' || !file?.hunks.length) continue
    if (changesCode(input, file)) drafts.push(unreadDraft(bucket, file))
  }
  const fileLevelUnits = drafts.length

  // Helpers fold into their owner; then identical sites fold into a mechanical unit; the rest stand alone.
  const open = code.filter((node) => !claimed.has(node.id))
  const helpers = helpersByOwner(work, open)
  const helperIds = new Set([...helpers.values()].flat().map((node) => node.id))
  for (const [ownerId, list] of helpers) {
    const owner = open.find((node) => node.id === ownerId)!
    drafts.push(nodeDraft(work, [owner, ...list.sort(byPosition)], 'definition-with-helpers', context))
    for (const node of [owner, ...list]) claimed.add(node.id)
  }
  const sites = new Map<string, ReviewNode[]>()
  for (const node of open.filter((item) => !claimed.has(item.id) && !helperIds.has(item.id))) {
    if (standsAlone(node, bucketOfNode(input.triage, node))) continue
    const key = signature(work, node)
    if (!key) continue
    const id = `${bucketOfNode(input.triage, node)?.id ?? ''}|${levelOf(node)}|${key}`
    sites.set(id, [...(sites.get(id) ?? []), node])
  }
  for (const list of sites.values()) {
    if (list.length < MECHANICAL_MIN) continue
    drafts.push(nodeDraft(work, list.sort(byPosition), 'mechanical', context))
    for (const node of list) claimed.add(node.id)
  }
  for (const node of open.filter((item) => !claimed.has(item.id))) drafts.push(nodeDraft(work, [node], 'single', context))

  return finish(drafts, input.triage, drafts.length > fileLevelUnits)
}

/** Dense stops, ordering inside a level, parts by entry point, ids, and the attention totals. */
function finish(drafts: Draft[], triage: Triage, hasNodeUnits: boolean): Units {
  const stops = [...new Set(drafts.map((draft) => draft.stop))].sort((a, b) => a - b)
  for (const draft of drafts) draft.unit.story_order = stops.indexOf(draft.stop) + 1

  const inLevel = (a: Draft, b: Draft) =>
    RANK[b.unit.level] - RANK[a.unit.level] ||
    a.unit.story_order - b.unit.story_order ||
    b.sensitive - a.sensitive ||
    a.path.localeCompare(b.path) ||
    a.line - b.line
  const parts = drafts.length > MAX_UNITS ? splitByEntry(drafts) : new Map(drafts.map((draft) => [draft, 1]))
  const ordered = [...drafts].sort((a, b) => parts.get(a)! - parts.get(b)! || inLevel(a, b))
  const partCount = Math.max(...parts.values(), 1)

  const units: Unit[] = ordered.map((draft, index) => {
    const base = { id: `u${index + 1}`, ...draft.unit }
    return partCount > 1 ? { ...base, part: parts.get(draft)! } : base
  })
  const nodesAlone = units.filter((unit) => unit.grouping !== 'bucket')
  const absorbedByBuckets = units.filter((unit) => unit.grouping === 'bucket').reduce((sum, unit) => sum + unit.nodes.length, 0)
  const collapsed = nodesAlone.reduce((sum, unit) => sum + unit.nodes.length - 1, 0) + absorbedByBuckets
  const hasBucketUnitForConfig = triage.buckets.some(
    (bucket) =>
      bucket.treatment === 'scan' &&
      bucket.kind !== 'code' &&
      units.some((unit) => unit.grouping === 'bucket' && unit.buckets?.includes(bucket.id)),
  )
  let mapKind: Units['map'] = 'node-level'
  if (!hasNodeUnits) mapKind = 'file-level'
  else if (hasBucketUnitForConfig) mapKind = 'mixed'
  const skipped = triage.buckets.filter((bucket) => bucket.treatment === 'skip')
  return {
    schema: 'review-units/1',
    map: mapKind,
    attention: {
      units: units.length,
      reading_minutes: units.reduce((sum, unit) => sum + unit.reading_minutes, 0),
      ...(collapsed ? { nodes_collapsed: collapsed } : {}),
      ...(triage.buckets.some((bucket) => bucket.sample)
        ? { files_sampled: triage.buckets.reduce((sum, bucket) => sum + (bucket.sample?.read.length ?? 0), 0) }
        : {}),
      ...(skipped.length ? { files_skipped: skipped.reduce((sum, bucket) => sum + bucket.files, 0) } : {}),
      parts: partCount,
    },
    units,
  }
}

/** Parts by entry point: whole entry groups go into a part while it stays within nine; a group larger than nine is cut in order. Nothing is dropped. */
function splitByEntry(drafts: Draft[]): Map<Draft, number> {
  const groups = new Map<string, Draft[]>()
  for (const draft of [...drafts].sort((a, b) => a.unit.story_order - b.unit.story_order || a.path.localeCompare(b.path))) {
    groups.set(draft.entry, [...(groups.get(draft.entry) ?? []), draft])
  }
  const result = new Map<Draft, number>()
  let part = 1
  let used = 0
  for (const group of groups.values()) {
    if (used > 0 && used + group.length > MAX_UNITS) {
      part++
      used = 0
    }
    for (const draft of group) {
      if (used === MAX_UNITS) {
        part++
        used = 0
      }
      result.set(draft, part)
      used++
    }
  }
  return result
}
