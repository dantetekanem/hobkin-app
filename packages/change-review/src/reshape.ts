/**
 * The Reviewer's reshaping of the map (spec 032): in the same answer as its levels and words, it may redefine a part,
 * move parts between units, make, merge and order units, add a part and take one out. Code applies each operation only
 * after checking it against the map, in the order given, and says why it refused one; a refused operation changes
 * nothing. Reshaping sets no level and no fact: a part keeps the level its floor and the risk events give it, a unit
 * is at the worst of its parts, and curate builds every unit, so each keeps the same fields in the same order.
 */
import { ADDED_BY_REVIEWER, type Layout, unitKey } from './curate.ts'
import type { Claim, FileDiff, ReviewNode, StoryWords, Unit } from './types.ts'

/** One operation of the answer's `map`, as model.ts reads it: well formed, not yet checked against the map. */
export type MapOp =
  | { op: 'describe'; node: string; title?: string; what?: string }
  | { op: 'move'; node: string; unit: string }
  | { op: 'unit'; id: string; nodes: string[]; title?: string; what?: string }
  | { op: 'merge'; units: string[]; title?: string; what?: string }
  | { op: 'order'; unit: string; nodes: string[] }
  | { op: 'order'; units: string[] }
  | { op: 'add'; id: string; path: string; lines: [number, number]; side: 'head' | 'base'; symbol?: string; unit?: string; title?: string; what?: string; why: string }
  | { op: 'remove'; node: string; why: string }
  /** A plainer name for a zone of the graph (spec 055): words only, so no part moves and no level changes. */
  | { op: 'zone'; zone: string; name: string }

/** The most lines one added part may span: a definition, never a whole file. */
export const MOST_ADDED_LINES = 200

/** The operation in a few words, for the line that says it was refused. */
function named(op: MapOp): string {
  switch (op.op) {
    case 'describe':
      return `describing ${op.node}`
    case 'move':
      return `moving ${op.node} to ${op.unit}`
    case 'unit':
      return `making unit ${op.id}`
    case 'merge':
      return `merging ${op.units.join(', ')}`
    case 'order':
      return 'unit' in op ? `ordering the parts of ${op.unit}` : 'ordering the units'
    case 'add':
      return `adding ${op.id}`
    case 'remove':
      return `removing ${op.node}`
    case 'zone':
      return `naming zone ${op.zone}`
  }
}

const refusal = (index: number, op: MapOp, reason: string) => `map[${index}] ${named(op)} was refused: ${reason}.`

// ───────────────────────── Adding parts ─────────────────────────

/** The lines of a file's diff on one side: added lines at head, removed lines at base. */
function changedOn(file: FileDiff | undefined, side: 'head' | 'base'): Set<number> {
  const lines = new Set<number>()
  for (const hunk of file?.hunks ?? []) {
    let [oldLine, newLine] = [hunk.oldStart, hunk.newStart]
    for (const line of hunk.lines) {
      if (line[0] === '+') {
        if (side === 'head') lines.add(newLine)
        newLine += 1
      } else if (line[0] === '-') {
        if (side === 'base') lines.add(oldLine)
        oldLine += 1
      } else if (line[0] !== '\\') {
        oldLine += 1
        newLine += 1
      }
    }
  }
  return lines
}

export interface AddedPartsInput {
  nodes: readonly ReviewNode[]
  diffs: readonly FileDiff[]
  /** The definitions the scan listed, changed or not: unchanged ones are what can be added as context. */
  scanned: readonly { symbol: string; path: string; lines: [number, number] }[]
  /** A file's text on a side, or null when it is not there. */
  source: (path: string, side: 'head' | 'base') => string | null
  runsInRequest: (path: string) => boolean
}

/**
 * The parts the answer adds, each checked first: an id not taken, a file of the change or of the scan, lines that
 * exist on that side, and none of them inside a part already mapped. One on lines the change touched is a part the
 * map missed: no test was looked for, so its floor is worth a look. One on unchanged lines at head is context, shown
 * beside the change: nothing in it changed, so it is safe. Unchanged lines at base are refused: context is read at head.
 */
export function addedParts(ops: readonly MapOp[], input: AddedPartsInput): { nodes: ReviewNode[]; problems: string[] } {
  const problems: string[] = []
  const nodes: ReviewNode[] = []
  const taken = new Set(input.nodes.map((node) => node.id))
  for (const [index, op] of ops.entries()) {
    if (op.op !== 'add') continue
    const refuse = (reason: string) => problems.push(refusal(index, op, reason))
    if (taken.has(op.id)) {
      refuse(`the id ${op.id} is taken`)
      continue
    }
    const file = input.diffs.find((entry) => (op.side === 'base' ? (entry.oldPath ?? entry.path) : entry.path) === op.path)
    const listed = input.scanned.find((entry) => entry.path === op.path && op.side === 'head')
    if (!file && !listed) {
      refuse(`${op.path} is not a file of the change or of the scan`)
      continue
    }
    const [start, end] = op.lines
    const onSide = (node: ReviewNode) => !node.extras.broken && (op.side === 'base' ? node.change === 'removed' : node.change !== 'removed')
    const inside = [...input.nodes, ...nodes].find((node) => node.path === op.path && onSide(node) && node.lines[0] <= end && start <= node.lines[1])
    if (inside) {
      refuse(`its lines are already in the map as \`${inside.id}\``)
      continue
    }
    const text = input.source(op.path, op.side)
    if (text == null) {
      refuse(`${op.path} is not there at ${op.side}`)
      continue
    }
    const length = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
    if (end > length) {
      refuse(`${op.path} has ${length} lines at ${op.side}, and the part ends at line ${end}`)
      continue
    }
    if (end - start + 1 > MOST_ADDED_LINES) {
      refuse(`a part spans at most ${MOST_ADDED_LINES} lines`)
      continue
    }
    const changed = [...changedOn(file, op.side)].filter((line) => line >= start && line <= end).sort((a, b) => a - b)
    if (!changed.length && op.side === 'base') {
      refuse('nothing in those lines at base was removed: unchanged code is added at head')
      continue
    }
    const exact = input.scanned.find((entry) => entry.path === op.path && entry.lines[0] === start && entry.lines[1] === end)
    const symbol = op.symbol ?? exact?.symbol ?? `${op.path}:${start}`
    const told = op.title || op.what ? { told: { ...(op.title ? { title: op.title } : {}), ...(op.what ? { what: op.what } : {}) } } : {}
    const common = { id: op.id, kind: 'general' as const, symbol, path: op.path, lines: [start, end] as [number, number], entries: [], conditions: [], hosts_condition: false, runs: [], sensitive: [], level: null, critical: false, watch: null, questions: [], ...told }
    taken.add(op.id)
    if (!changed.length) {
      nodes.push({
        ...common,
        change: 'none',
        changed_lines: [],
        facts: {
          effect: { value: 'text', evidence: 'nothing in these lines changed: shown for context' },
          proof: { value: 'not-applicable', evidence: 'unchanged: there is no change to prove' },
          exposure: { value: 'everyone', evidence: 'unchanged: it runs as it did' },
          undo: { value: 'rollback', evidence: 'nothing in it changed' },
        },
        extras: { context: true },
        findings: [{ rule: 'context', text: `The Reviewer added it for context: ${op.why}.`, by: 'model' }],
      })
      continue
    }
    const span = end - start + 1
    nodes.push({
      ...common,
      change: op.side === 'base' ? 'removed' : changed.length >= span ? 'added' : 'modified',
      changed_lines: op.side === 'base' ? [] : changed,
      facts: {
        effect: { value: 'behaviour', evidence: 'what the changed lines do is read from the diff' },
        proof: { value: 'unknown', evidence: 'the Reviewer added it after the tests ran, so no test was looked for' },
        exposure: { value: 'everyone', evidence: 'no condition in front of it was looked for' },
        undo: { value: 'rollback', evidence: 'a rollback undoes it' },
      },
      extras: input.runsInRequest(op.path) ? {} : { runsInRequest: false },
      findings: [{ rule: ADDED_BY_REVIEWER, text: `The Reviewer added it to the map: ${op.why}. What calls it and what tests it were not looked for.`, by: 'model' }],
    })
  }
  return { nodes, problems }
}

// ───────────────────────── Reshaping the units ─────────────────────────

/** Findings that say a test failed or hung with the change, or that something it removed is still used. */
const FAILING = new Set(['breaks-test', 'failing-test', 'test-timeout', 'dangling-reference'])

const short = (symbol: string) => symbol.split(/#|::|\./).filter(Boolean).pop() ?? symbol
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The first claim that names a node: by its symbol, its short name or its path, as a whole word. */
function citing(node: ReviewNode, claims: readonly Claim[]): Claim | undefined {
  const names = [...new Set([node.symbol, short(node.symbol), node.path])].filter((name) => name.length >= 3)
  const pattern = new RegExp(`(?<![\\w$])(${names.map(escaped).join('|')})(?![\\w$])`)
  return claims.find((claim) => pattern.test(`${claim.text} ${claim.evidence ?? ''}`))
}

interface Group {
  id: string
  nodes: string[]
  buckets?: string[]
  /** A bucket's unit: what it holds was decided by its checks, so nothing moves in or out. */
  fixed: boolean
  /** The Reviewer changed what it holds, or their order: curate builds it as given. */
  touched: boolean
}

export interface ReshapeInput {
  /** Every node, with the levels the floor and the events gave it, and the parts this answer added. */
  nodes: readonly ReviewNode[]
  /** The units as the Reviewer was shown them. */
  units: readonly Pick<Unit, 'id' | 'nodes' | 'buckets' | 'grouping'>[]
  ops: readonly MapOp[]
  /** The ids of the parts `addedParts` accepted. */
  added: ReadonlySet<string>
  /** The change's claims, as the answer settled them. */
  claims: readonly Claim[]
  /** Nodes that are always a unit of their own (`standsAloneIn`). */
  alone: (id: string) => boolean
  /** The zones of the graph, which a `zone` operation may rename. */
  zones?: readonly { id: string; label: string }[]
}

export interface Reshaped {
  /** The nodes with the Reviewer's words and the parts it took out marked `hidden`. Levels and facts are as given. */
  nodes: ReviewNode[]
  /** What curate builds the units from, or null when no unit changed. */
  layout: Layout | null
  /** Every unit as the operations left it, by the id the answer knows it by, for carrying words to the built units. */
  groups: { id: string; nodes: string[]; buckets?: string[] }[]
  /** Words given with a unit the answer made or merged, by that id. */
  words: NonNullable<StoryWords['units']>
  /** The Reviewer's names for zones, by zone id. */
  zones: Record<string, string>
  problems: string[]
}

/** Applies the map's operations, each checked against the map as the earlier ones left it. */
export function reshapeMap(input: ReshapeInput): Reshaped {
  const problems: string[] = []
  const nodes = new Map(input.nodes.map((node) => [node.id, structuredClone(node)]))
  const groups: Group[] = input.units.map((unit) => ({ id: unit.id, nodes: [...unit.nodes], ...(unit.buckets ? { buckets: unit.buckets } : {}), fixed: unit.grouping === 'bucket', touched: false }))
  const words: Reshaped['words'] = {}
  const zones: Reshaped['zones'] = {}
  let order: string[] | null = null

  const groupOf = (id: string) => groups.find((group) => group.nodes.includes(id))
  const unitById = (id: string) => groups.find((group) => group.id === id)
  const visible = (id: string) => {
    const node = nodes.get(id)
    return node && !node.hidden ? node : undefined
  }
  /** Why a node cannot leave where it is for another unit, or null. */
  const unmovable = (id: string): string | null => {
    const node = visible(id)
    if (!node) return `no part ${id} in the map`
    if (node.kind === 'test') return `${id} is a test: it is proof for the code it runs, never a part of a unit`
    if (groupOf(id)?.fixed) return `${id} is read with its bucket of files`
    return null
  }
  /** Why a unit cannot hold these nodes together, or null: a part always told on its own is never with another. */
  const crowded = (members: readonly string[], target: string): string | null => {
    if (members.length < 2) return null
    const lone = members.find((id) => input.alone(id))
    if (!lone) return null
    return unitById(target)?.nodes.includes(lone) ? `${target} holds a part that is always told on its own` : `${lone} is always told on its own`
  }
  const wordsFor = (id: string, op: { title?: string; what?: string }) => {
    if (op.title || op.what) words[id] = { ...words[id], ...(op.title ? { title: op.title } : {}), ...(op.what ? { what: op.what } : {}) }
  }
  /** Puts nodes into a unit, in this order after what it holds, taking each out of the unit it was in. */
  const place = (members: readonly string[], target: Group) => {
    for (const id of members) {
      const from = groupOf(id)
      if (from) from.nodes = from.nodes.filter((other) => other !== id)
      target.nodes.push(id)
    }
    target.touched = true
  }

  for (const [index, op] of input.ops.entries()) {
    const refuse = (reason: string) => problems.push(refusal(index, op, reason))
    switch (op.op) {
      case 'describe': {
        const node = visible(op.node)
        if (!node || node.kind === 'test') refuse(node ? `${op.node} is a test` : `no part ${op.node} in the map`)
        else node.told = { ...node.told, ...(op.title ? { title: op.title } : {}), ...(op.what ? { what: op.what } : {}) }
        break
      }
      case 'remove': {
        const node = visible(op.node)
        const reason = node ? removalRefused(node, groupOf(node.id), input) : `no part ${op.node} in the map`
        if (reason) refuse(reason)
        else {
          node!.hidden = op.why
          const from = groupOf(node!.id)
          if (from) from.nodes = from.nodes.filter((id) => id !== node!.id)
        }
        break
      }
      case 'move':
      case 'add': {
        if (op.op === 'add' && (!input.added.has(op.id) || !op.unit)) break
        const id = op.op === 'add' ? op.id : op.node
        const target = unitById(op.unit!)
        const reason = unmovable(id) ?? (!target ? `no unit ${op.unit}` : target.fixed ? `${op.unit} is a bucket of files` : crowded([...target.nodes.filter((other) => other !== id), id], target.id))
        if (reason) refuse(reason)
        else if (groupOf(id) !== target) place([id], target!)
        break
      }
      case 'unit': {
        const members = [...new Set(op.nodes)]
        const reason = unitById(op.id) ? `the unit ${op.id} is there already` : (members.map(unmovable).find(Boolean) ?? crowded(members, op.id))
        if (reason) refuse(reason)
        else {
          const made: Group = { id: op.id, nodes: [], fixed: false, touched: true }
          groups.push(made)
          place(members, made)
          wordsFor(op.id, op)
        }
        break
      }
      case 'merge': {
        const merged = [...new Set(op.units)].map((id) => ({ id, group: unitById(id) }))
        const missing = merged.find((entry) => !entry.group)
        const bucket = merged.find((entry) => entry.group?.fixed)
        const members = merged.flatMap((entry) => entry.group?.nodes ?? [])
        const reason = missing ? `no unit ${missing.id}` : bucket ? `${bucket.id} is a bucket of files` : merged.length < 2 ? 'a merge needs two units' : crowded(members, merged[0]!.id)
        if (reason) refuse(reason)
        else {
          const [target, ...rest] = merged.map((entry) => entry.group!)
          place(rest.flatMap((group) => group.nodes), target!)
          wordsFor(target!.id, op)
        }
        break
      }
      case 'zone': {
        if (!input.zones?.some((zone) => zone.id === op.zone)) refuse(`no zone ${op.zone} in the map`)
        else zones[op.zone] = op.name
        break
      }
      case 'order': {
        if ('units' in op) {
          const known = op.units.filter((id) => unitById(id))
          if (known.length < op.units.length) refuse(`no unit ${op.units.find((id) => !unitById(id))}; the others are ordered`)
          order = [...new Set(known)]
          break
        }
        const target = unitById(op.unit)
        if (!target || target.fixed) {
          refuse(target ? `${op.unit} is a bucket of files` : `no unit ${op.unit}`)
          break
        }
        const first = [...new Set(op.nodes)].filter((id) => target.nodes.includes(id))
        if (first.length < new Set(op.nodes).size) refuse(`${op.unit} does not hold ${op.nodes.find((id) => !target.nodes.includes(id))}; its other parts are ordered`)
        target.nodes = [...first, ...target.nodes.filter((id) => !first.includes(id))]
        target.touched = true
        break
      }
    }
  }

  const shown = groups.map((group) => ({ ...group, nodes: group.nodes.filter((id) => visible(id)) }))
  const touched = shown.filter((group) => group.touched && group.nodes.length)
  const walk = (order ?? []).map((id) => shown.find((group) => group.id === id)!).filter((group) => group.nodes.length || group.buckets?.length)
  return {
    nodes: input.nodes.map((node) => nodes.get(node.id)!),
    layout: touched.length || walk.length ? { groups: touched.map((group) => group.nodes), order: walk.map(unitKey) } : null,
    groups: shown.map(({ id, nodes: members, buckets }) => ({ id, nodes: members, ...(buckets ? { buckets } : {}) })),
    words,
    zones,
    problems,
  }
}

/**
 * Why a part cannot come out of the map, or null: only a safe part that nothing can hide behind. Not one above safe,
 * one a test fails with or whose tests could not run, one that holds a condition check, carries a question, is named
 * by a claim, is read with its bucket, or is always told on its own.
 */
function removalRefused(node: ReviewNode, group: Group | undefined, input: ReshapeInput): string | null {
  const level = node.level?.current ?? 'mid'
  if (node.kind === 'test') return 'a test is proof for the code it runs, never a part of the map to take out'
  if (level !== 'safe' || node.critical) return `it is ${level}: only a safe part comes out of the map`
  if (node.extras.broken || node.findings.some((finding) => FAILING.has(finding.rule)) || node.runs.some((run) => run.failed.length > 0 && run.kind === 'baseline')) return 'a test fails with it'
  if (node.facts.proof.value === 'unknown') return 'its tests could not run, so nothing shows it is safe'
  if (node.hosts_condition || node.conditions.some((condition) => condition.added)) return 'it holds a condition check, which runs for everyone'
  if (node.questions.length) return 'it carries a question for the reviewer'
  const claim = citing(node, input.claims)
  if (claim) return `the claim "${claim.text.length > 80 ? `${claim.text.slice(0, 79)}…` : claim.text}" names it`
  if (group?.fixed) return 'it is read with its bucket of files'
  if (input.alone(node.id)) return 'it is always told on its own'
  return null
}

/**
 * Words written for units as the answer knew them, carried to the units built after: a unit holding the same nodes
 * (or, with none, the same buckets) takes them. With no reshaping, the units the Reviewer was shown are the groups.
 */
export function carryWords(words: StoryWords, from: readonly Pick<Unit, 'id' | 'nodes' | 'buckets'>[], to: readonly Unit[]): StoryWords {
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
