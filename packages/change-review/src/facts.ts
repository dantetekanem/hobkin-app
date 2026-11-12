import { lineKinds, type LineKind } from './comments.ts'
import { isNotRequestPath, rx, sensitiveOf } from './config.ts'
import type { ReviewConfig } from './config.ts'
import type { Condition, Effect, Exposure, Fact, Facts, FloorExtras, Guard, ScanAnchor, Undo } from './types.ts'

/** A place that calls the node, and whether the call sits behind the condition, on its on branch. */
export interface CallerSite {
  path: string
  line: number
  guardedOn: boolean
}

export interface FactsInput {
  anchor: ScanAnchor
  path: string
  /** The file at head and at base, one string per line. Null when it is missing or unreadable. */
  head: string[] | null
  base: string[] | null
  config: ReviewConfig
  /** Who calls the node, when known. `callersComplete` says the list is every caller. */
  callers?: CallerSite[]
  callersComplete?: boolean
}

export interface NodeFacts {
  /** The proof fact is the next step's: tests run for it. */
  facts: Omit<Facts, 'proof'>
  extras: FloorExtras
  conditions: Condition[]
  hosts_condition: boolean
  /** Every effect found, most severe first. */
  effects: Effect[]
  sensitive: string[]
}

// ───────────────────────── Reading lines ─────────────────────────

const SEVERITY: Effect[] = ['interface', 'data', 'load', 'behaviour', 'text']

const isBlank = (text: string) => text.trim() === ''

/** Lines that only open or close a block. They belong to a condition's shape, not to what the code does. */
const isCloser = (text: string) => /^(end|else|\{|\}|\)|\}\s*else\s*\{?|else\s*\{?)$/.test(text.trim())

const matches = (pattern: string, text: string) => rx(pattern).test(text)

/** Which of the node's lines hold nothing that runs, as the file's language reads them (comments.ts). */
interface Reading {
  /** Line `n` at head is blank or only a comment. False for a line that cannot be read. */
  quiet(n: number): boolean
  /** The lines the diff removed, each with whether it was blank or only a comment where it stood at base. */
  removed: { text: string; quiet: boolean }[]
}

const read = new WeakMap<readonly string[], LineKind[]>()
const isQuiet = (kind: LineKind | undefined) => kind === 'blank' || kind === 'comment'

/** Every line's kind, read once per file: a comment depends on what the lines above it opened. */
function kindsOf(path: string, lines: readonly string[] | null): LineKind[] {
  if (!lines) return []
  let kinds = read.get(lines)
  if (!kinds) {
    kinds = lineKinds(path, lines.join('\n'))
    read.set(lines, kinds)
  }
  return kinds
}

/** A removed line is read at the base line it came from; one not found there cannot be read, so it counts as code. */
function readingOf({ anchor, path, head, base }: FactsInput): Reading {
  const atHead = kindsOf(path, head)
  const atBase = kindsOf(path, base)
  return {
    quiet: (n) => isQuiet(atHead[n - 1]),
    removed: (anchor.removed ?? []).flatMap((block) =>
      block.lines.map((text, offset) => {
        const at = block.oldStart - 1 + offset
        return { text, quiet: base?.[at] === text && isQuiet(atBase[at]) }
      }),
    ),
  }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Whether the anchor's definition is gone at head: the lines the diff removed name it, and none of its lines at head
 * does. Anything less is a definition still there, with lines deleted inside it, which tests can prove.
 */
export function goneAtHead(anchor: Pick<ScanAnchor, 'symbol' | 'startLine' | 'endLine' | 'removed'>, head: readonly string[] | null): boolean {
  const name = anchor.symbol.split(/#|::|\./).filter(Boolean).at(-1) ?? ''
  if (!name) return false
  const named = new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`)
  const removed = (anchor.removed ?? []).some((block) => block.lines.some((line) => named.test(line)))
  return removed && !(head ?? []).slice(anchor.startLine - 1, anchor.endLine).some((line) => named.test(line))
}

// ───────────────────────── Flag checks and the lines they dominate ─────────────────────────

interface Check {
  name: string
  line: number
  text: string
  subset: boolean
}

interface Mark {
  /** Index in the checks list. */
  check: number
  /** `scaffold`: the check's own line, its else and its end. `expr`: the flag value is used some other way and dominance is not traced. */
  state: 'on' | 'off' | 'scaffold' | 'expr'
}

const indentOf = (text: string) => text.search(/\S/)

function matchCheck(text: string, config: ReviewConfig): { name: string; index: number; subset: boolean } | null {
  const lists: [string[], boolean][] = [[config.flags.check, false], [config.flags.subset, true]]
  for (const [patterns, subset] of lists) {
    for (const pattern of patterns) {
      const m = rx(pattern).exec(text)
      if (m) return { name: m.groups?.flag || text.trim(), index: m.index, subset }
    }
  }
  return null
}

/**
 * Finds the condition checks in lines `start` to `end` and, from indentation, which lines sit on which branch of each.
 * It reads the shapes `if`/`unless` blocks, `return ... if`/`unless` guards, JS `if (..) return`, and `... if flag`.
 * A flag stored or passed along is `expr`: nothing it governs is proven.
 */
function gateRegions(lines: string[], start: number, end: number, config: ReviewConfig, reading: Reading): { checks: Check[]; marks: Map<number, Mark[]> } {
  const at = (n: number) => lines[n - 1] ?? ''
  const checks: Check[] = []
  const marks = new Map<number, Mark[]>()
  const mark = (from: number, to: number, check: number, state: Mark['state']) => {
    for (let n = from; n <= to; n += 1) marks.set(n, [...(marks.get(n) ?? []), { check, state }])
  }

  for (let n = start; n <= end; n += 1) {
    const text = at(n)
    if (reading.quiet(n)) continue
    const hit = matchCheck(text, config)
    if (!hit) continue
    const id = checks.length
    checks.push({ name: hit.name, line: n, text: text.trim(), subset: hit.subset })
    const t = text.trim()
    const indent = indentOf(text)
    const negated = /(^|\W)(!|not\s+)\s*$/.test(text.slice(0, hit.index))

    const jsGuard = /^if\s*\(.*\)\s*(return|throw)\b/.test(t)
    const guard = jsGuard ? ['', '', 'if'] : t.match(/^(return|next|break|raise)\b.*\b(if|unless)\b/)
    const block = !guard && t.match(/^(if|unless|elsif|else if|\}\s*else if)\b/)
    const modifier = !block && !guard && text.slice(0, hit.index).match(/\b(if|unless)\s+(!|not\s+)?\s*$/)

    if (block) {
      // `firstOff`: the first body runs with the condition off.
      const firstOff = block[1] === 'unless' ? !negated : negated
      let close = n + 1
      let elseLine: number | undefined
      for (; close <= end; close += 1) {
        const line = at(close)
        if (isBlank(line) || indentOf(line) > indent) continue
        const head = line.trim()
        if (indentOf(line) === indent && /^(else\b|\}\s*else\b(?!\s*if))/.test(head) && elseLine === undefined) {
          elseLine = close
          continue
        }
        if (indentOf(line) === indent && /^(elsif\b|\}\s*else if\b)/.test(head)) {
          elseLine = elseLine ?? close
          continue
        }
        break
      }
      const bodyEnd = (elseLine ?? close) - 1
      mark(n, n, id, 'scaffold')
      mark(n + 1, bodyEnd, id, firstOff ? 'off' : 'on')
      if (elseLine !== undefined) {
        mark(elseLine, elseLine, id, 'scaffold')
        mark(elseLine + 1, close - 1, id, firstOff ? 'on' : 'off')
      }
      if (close <= end && close !== end) mark(close, close, id, 'scaffold')
    } else if (guard) {
      const leavesWhenOff = guard[2] === 'unless' ? !negated : negated
      // The guard's own action runs in one state; the rest of the block runs in the other.
      mark(n, n, id, leavesWhenOff ? 'off' : 'on')
      for (let rest = n + 1; rest <= end; rest += 1) {
        const line = at(rest)
        if (!isBlank(line) && indentOf(line) < indent) break
        if (!isBlank(line)) mark(rest, rest, id, leavesWhenOff ? 'on' : 'off')
      }
    } else if (modifier) {
      const on = modifier[1] === 'unless' ? Boolean(modifier[2]) : !modifier[2]
      mark(n, n, id, on ? 'on' : 'off')
    } else {
      mark(n, n, id, 'expr')
    }
  }
  return { checks, marks }
}

/** From the search tool's own guards: the state a guard puts a line in, or null when it is not a condition check of this node. */
function guardState(guard: Guard, checks: Check[], range: [number, number], config: ReviewConfig): Mark | null {
  const hit = matchCheck(guard.text, config)
  if (!hit || guard.line < range[0] || guard.line > range[1]) return null
  let index = checks.findIndex((c) => c.line === guard.line)
  if (index < 0) {
    checks.push({ name: hit.name, line: guard.line, text: guard.text.trim(), subset: hit.subset })
    index = checks.length - 1
  }
  const negated = /(^|\W)(!|not\s+)\s*$/.test(guard.text.slice(0, hit.index)) || /^\s*unless\b/.test(guard.text)
  // `else` and `after-return` both mean the guard's own condition is false from here on.
  const on = guard.branch === 'then' ? !negated : negated
  return { check: index, state: on ? 'on' : 'off' }
}

// ───────────────────────── Effect ─────────────────────────

interface EffectResult {
  effects: Effect[]
  main: Fact<Effect>
  additive: boolean
  destructive: boolean
}

const migrationPath = (path: string, config: ReviewConfig) => matches(config.ungateable.migration, path) || matches(config.ungateable.schema, path)
const ungateablePath = (path: string, config: ReviewConfig) => Object.values(config.ungateable).some((p) => matches(p, path))
const loadPath = (path: string, config: ReviewConfig) => matches(config.ungateable.config, path) || matches(config.ungateable.dependency, path)

function deriveEffect(input: FactsInput, reading: Reading): EffectResult {
  const { anchor, path, head, config } = input
  const textOf = (n: number): string | undefined => head?.[n - 1]
  const changed = anchor.changedLines
  const removed = reading.removed
  const reasons = new Map<Effect, string>()
  const note = (effect: Effect, why: string) => {
    if (!reasons.has(effect)) reasons.set(effect, why)
  }
  const reported = (what: string) => `${what} (from the search tool)`
  const found = (what: string) => `${what} (from patterns)`

  const whitespace = new Set(anchor.whitespaceOnly ?? [])
  const texts = changed.map((n) => ({ n, text: textOf(n) }))
  const code = texts.filter(({ n }) => !whitespace.has(n) && !reading.quiet(n))
  const removedCode = removed.filter((line) => !line.quiet).map((line) => line.text)
  const allWhitespace = changed.length > 0 && changed.every((n) => whitespace.has(n))

  const nothingReported = changed.length === 0 && removed.length === 0
  const onlyText = !nothingReported && (allWhitespace || (code.length === 0 && removedCode.length === 0))
  if (onlyText) {
    note('text', allWhitespace ? reported('every changed line is whitespace only') : found('only comment or blank lines changed'))
  }

  const migration = migrationPath(path, config)
  const changedText = code.map(({ text }) => text ?? '').join('\n')
  let destructive = false
  let additive = false

  if (!onlyText) {
    // interface
    const looksLikeDefinition = (line: string) => /^\s*(def |function\b|async function\b|class |module |export\b)|=>\s*\{?\s*$|\)\s*(:\s*[^={]+)?\{\s*$/.test(line)
    if (anchor.signatureChanged === true) note('interface', reported('signature changed'))
    else if (anchor.signatureChanged === undefined) {
      const startLineChanged = changed.includes(anchor.startLine)
      const removedADefinition = (anchor.removed ?? []).some((block) => block.lines.some(looksLikeDefinition))
      if (startLineChanged && removedADefinition && anchor.status !== 'added') {
        note('interface', found('the definition line changed'))
      }
    }
    if (changed.length === 0 && removedCode.length > 0) {
      if (goneAtHead(anchor, head)) note('interface', found('a definition was removed'))
      else note('behaviour', found('lines were deleted inside the definition'))
    }

    // data
    const signals = config.signals
    const lineHits = (pattern: string) => code.find(({ text }) => text !== undefined && matches(pattern, text))
    if (anchor.effects !== undefined) {
      const first = anchor.effects[0]
      if (first) note('data', reported(`${first.kind} on line ${first.line}`))
    } else {
      for (const kind of ['write', 'enqueue', 'cache_key'] as const) {
        const hit = lineHits(signals[kind])
        if (hit) note('data', found(`${kind} on line ${hit.n}`))
      }
    }
    for (const kind of ['cache_key', 'serialization'] as const) {
      const hit = lineHits(signals[kind])
      if (hit) note('data', found(`${kind} on line ${hit.n}`))
      else if (changed.length > 0 && matches(signals[kind], anchor.symbol)) note('data', found(`${kind} in the name ${anchor.symbol}`))
    }
    if (migration) {
      note('data', found(`schema or migration file ${path}`))
      destructive = matches(config.migration.destructive, changedText)
      additive = !destructive && changed.length > 0 && (matches(config.migration.additive, changedText) || (matches(config.ungateable.schema, path) && removedCode.length === 0))
    }

    // load
    if (anchor.loadTime === true) note('load', reported('takes effect at load'))
    else if (anchor.loadTime === undefined && (anchor.kind === 'constant' || anchor.kind === 'statement')) note('load', found(`${anchor.kind} changed`))
    if (loadPath(path, config)) note('load', found(`configuration or dependency file ${path}`))

    // behaviour
    if (reasons.size === 0 || code.length > 0 || nothingReported) {
      let why = 'source lines not available, so treated as behaviour'
      if (nothingReported) why = found('no changed lines reported')
      else if (head) why = found('executable lines changed')
      note('behaviour', why)
    }
  }

  const effects = SEVERITY.filter((e) => reasons.has(e))
  const main = effects[0] ?? 'behaviour'
  const others = effects.slice(1)
  const evidence = `${reasons.get(main) ?? ''}${others.length ? `; also ${others.join(', ')}` : ''}`
  return { effects, main: { value: main, evidence }, additive, destructive }
}

// ───────────────────────── Exposure and undo ─────────────────────────

/** Whether the old code is still what runs with the condition off: every off-branch line was there at base, and nothing from base was lost. */
function offPathIsOld(lines: string[], range: [number, number], marks: Map<number, Mark[]>, reading: Reading, base: string[] | null): boolean {
  const trimmed = (text: string) => text.trim()
  const baseSet = new Set((base ?? []).map(trimmed))
  const headSet = new Set<string>()
  const off: string[] = []
  for (let n = range[0]; n <= range[1]; n += 1) {
    const text = lines[n - 1] ?? ''
    if (reading.quiet(n) || isCloser(text)) continue
    headSet.add(trimmed(text))
    if ((marks.get(n) ?? []).some((m) => m.state === 'off')) off.push(trimmed(text))
  }
  if (!off.every((text) => baseSet.has(text))) return false
  const lost = reading.removed.filter((line) => !line.quiet && !isCloser(line.text)).map((line) => trimmed(line.text))
  return lost.every((text) => headSet.has(text))
}

interface ExposureResult {
  fact: Fact<Exposure>
  conditions: Condition[]
  hosts: boolean
}

function deriveConditions(input: FactsInput, reading: Reading): { checks: Check[]; stateAt: (line: number) => Mark[]; viaGuards: boolean; marks: Map<number, Mark[]> } {
  const { anchor, head, config } = input
  const range: [number, number] = [anchor.startLine, anchor.endLine]
  const { checks, marks } = head ? gateRegions(head, range[0], range[1], config, reading) : { checks: [] as Check[], marks: new Map<number, Mark[]>() }
  const guards = anchor.guards
  const fromTool = new Map<number, Mark[]>()
  if (guards) {
    for (const entry of guards) {
      const found = entry.guards.map((g) => guardState(g, checks, range, config)).filter((m): m is Mark => m !== null)
      fromTool.set(entry.line, found)
    }
  }
  const stateAt = (line: number): Mark[] => {
    const own = marks.get(line) ?? []
    if (own.some((m) => m.state === 'scaffold')) return own.filter((m) => m.state === 'scaffold')
    return guards ? (fromTool.get(line) ?? []) : own
  }
  return { checks, stateAt, viaGuards: guards !== undefined, marks }
}

function deriveExposure(input: FactsInput, effect: EffectResult, reading: Reading): ExposureResult {
  const { anchor, path, head, base, config } = input
  const range: [number, number] = [anchor.startLine, anchor.endLine]
  const { checks, stateAt, viaGuards, marks } = deriveConditions(input, reading)
  const changed = anchor.changedLines
  const added = new Set(changed)

  const conditions: Condition[] = checks.map((c) => ({
    name: c.name,
    line: c.line,
    text: c.text,
    dominates: changed.flatMap((line) =>
      stateAt(line)
        .filter((m) => m.check === checks.indexOf(c) && (m.state === 'on' || m.state === 'off'))
        .map((m) => ({ line, state: m.state as 'on' | 'off' })),
    ),
    added: added.has(c.line),
  }))
  const hosts = conditions.some((c) => c.added)
  const result = (value: Exposure, evidence: string): ExposureResult => ({ fact: { value, evidence }, conditions, hosts })
  const how = viaGuards ? 'guards from the search tool' : 'indent-based branches'

  if (effect.main.value === 'text') return result('everyone', 'only text changed: nothing runs differently')
  if (effect.effects.includes('load') || ungateablePath(path, config)) return result('at-load', 'takes effect when code loads or deploys, before any request-time condition')

  const relevant = changed.filter((line) => {
    const text = head?.[line - 1]
    if (text === undefined) return true
    if (reading.quiet(line) || isCloser(text) || (anchor.whitespaceOnly ?? []).includes(line)) return false
    return !stateAt(line).some((m) => m.state === 'scaffold')
  })

  let reason = 'no flag check is shown to dominate the changed lines'
  if (!head) reason = 'source lines not available'
  else if (relevant.length === 0) reason = 'no changed line is behind a condition'
  else {
    const states = relevant.map((line) => stateAt(line))
    const unguarded = relevant.find((_, i) => states[i]?.length === 0)
    const notOn = relevant.find((_, i) => states[i]?.some((m) => m.state !== 'on'))
    if (unguarded !== undefined) reason = `line ${unguarded} is not behind any condition check`
    else if (notOn !== undefined) reason = `line ${notOn} runs with the condition off or in a form that is not traced`
    else if (!offPathIsOld(head, range, marks, reading, base)) reason = 'the off path differs from the old code'
    else {
      const strict = states.every((s) => s.some((m) => !checks[m.check]?.subset))
      const first = checks[states[0]?.[0]?.check ?? 0]
      const evidence = `every changed line is on the on branch of ${first?.name ?? 'the condition'} (line ${first?.line}), off path is the old code (${how})`
      return result(strict ? 'nobody-yet' : 'subset', evidence)
    }
  }

  const callers = input.callers ?? []
  if (input.callersComplete === true && callers.length > 0 && callers.every((c) => c.guardedOn)) {
    return result('nobody-yet', `dominance proven: all ${callers.length} callers are behind the condition`)
  }
  if (input.callersComplete === true && callers.length > 0) reason += `; ${callers.filter((c) => !c.guardedOn).length} of ${callers.length} callers are not behind it`
  else if (input.callersComplete === false) reason += '; the caller list is incomplete'
  return result('everyone', reason)
}

function deriveUndo(exposure: Exposure, effect: EffectResult, path: string, config: ReviewConfig): Fact<Undo> {
  if (effect.destructive && migrationPath(path, config)) return { value: 'none', evidence: 'destructive migration: data or structure is dropped or rewritten' }
  if (exposure === 'nobody-yet') {
    if (effect.effects.includes('data')) return { value: 'flag-with-residue', evidence: 'turning the condition off stops new effects; writes made while on remain' }
    return { value: 'flag', evidence: 'turning the condition off restores the old behaviour; nothing is written' }
  }
  return { value: 'rollback', evidence: 'reverting the deploy restores the old behaviour' }
}

/**
 * Establishes effect, exposure and undo for one node, from the search tool's reported facts where present and from
 * patterns and indentation where not (the evidence says which). Pure: it reads only its input. Whatever is not proven
 * is the worse case: `everyone`, with the reason.
 */
export function deriveFacts(input: FactsInput): NodeFacts {
  const { anchor, path, config } = input
  const reading = readingOf(input)
  const effect = deriveEffect(input, reading)
  const exposure = deriveExposure(input, effect, reading)
  const undo = deriveUndo(exposure.fact.value, effect, path, config)
  const extras: FloorExtras = {}
  if (effect.additive) extras.additiveSchema = true
  if (anchor.kind === 'test' || isNotRequestPath(path, config)) extras.runsInRequest = false
  return {
    facts: { effect: effect.main, exposure: exposure.fact, undo },
    extras,
    conditions: exposure.conditions,
    hosts_condition: exposure.hosts,
    effects: effect.effects,
    sensitive: sensitiveOf(anchor.symbol, path, config),
  }
}
