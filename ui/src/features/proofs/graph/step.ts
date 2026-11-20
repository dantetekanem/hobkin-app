/**
 * The selected state, as the inspector beside the graph tells it (_specs/050-tla-proofs A9): where it is on the
 * counterexample, the action that led to it and its code, a line of story, each variable with what changed marked and
 * what breaks the rule in red, and the rule read at that state. Pure, so the tests run it with Node alone.
 *
 * The window does not evaluate TLA+. What breaks a rule is read from the rule's text: the variables it requires (after
 * its last ⇒), at the keys the breaking move changed. Its values are put in for the variables it names.
 */
import type { ProofRule, ProofRun } from '#shared/protocol/proofs.ts'
import type { GraphState, Move, StateGraph } from './model.ts'
import { actionName, formatValue, keysOf, lensValue, type StateVars } from './values.ts'

export interface Cell {
  text: string
  /** What it was in the state before, when it changed. */
  was?: string
  changed: boolean
  breaks: boolean
  /** A key the counterexample never moves steps back. */
  quiet: boolean
  /** A variable with no keys spans every key's column. */
  span?: number
}

export interface Row {
  name: string
  cells: Cell[]
}

export interface Verdict {
  tone: 'plain' | 'bad' | 'ok'
  title: string
  formula: string
  words: string
}

export interface StateFacts {
  title: string
  action: string
  code?: string
  story: string
  /** The table's value columns: one per key when the variables are functions of a few keys, else one. */
  columns: string[]
  rows: Row[]
  verdict: Verdict
}

/** What the user picked: a state, and its place on the counterexample when they picked it there. */
export interface Picked {
  id: string
  step?: number
}

/** More keys than this and the table shows each variable whole. */
const KEY_COLUMNS = 4
/** A story names this many changes, and counts the rest. */
const NAMED_CHANGES = 2

const unique = <Value>(values: Iterable<Value>) => [...new Set(values)]
const IDENTIFIER = /[A-Za-z_]\w*/g

/** Text outside string literals changed by `change`, strings kept as written. */
function outsideStrings(text: string, change: (part: string) => string): string {
  return text
    .split(/("(?:[^"\\]|\\.)*")/)
    .map((part, index) => (index % 2 === 1 ? part : change(part)))
    .join('')
}

/** A definition's body: what follows its ≜, on one line. */
function bodyOf(lines: readonly string[]): string {
  const text = lines.join(' ')
  const at = text.indexOf('≜')
  return (at >= 0 ? text.slice(at + 1) : text).replace(/\s+/g, ' ').trim()
}

/** The part a rule requires: after its last ⇒, or all of it. */
const requiredPart = (body: string) => {
  const at = body.lastIndexOf('⇒')
  return at >= 0 ? body.slice(at + 1).trim() : body
}

const namedIn = (text: string, names: ReadonlySet<string>) => unique(outsideStrings(text, (part) => part).match(IDENTIFIER) ?? []).filter((name) => names.has(name))

/** `∀ i ∈ Items : P(i)` said of one key: `P(i1)`. Anything else stays as written. */
function instantiate(body: string, key: string | null): string {
  const bound = /^∀\s*([A-Za-z_]\w*)\s*∈\s*[^:]+?\s*:\s*(.+)$/s.exec(body)
  if (!bound || key == null) return body
  const [, name, rest] = bound as unknown as [string, string, string]
  return outsideStrings(rest, (part) => part.replace(new RegExp(`\\b${name}\\b`, 'g'), key))
}

/** The rule's text with this state's values in place of the variables it names: `reviewed[i1] = head[i1]` as `1 = 2`. */
function valued(text: string, vars: StateVars, names: ReadonlySet<string>): string {
  return outsideStrings(text, (part) =>
    part.replace(/([A-Za-z_]\w*)(?:\[([^\]]+)\]|\.([A-Za-z_]\w*))?/g, (whole, variable: string, bracket?: string, dot?: string) => {
      if (!names.has(variable)) return whole
      const value = lensValue(vars, { variable, key: bracket ?? dot })
      return value ? formatValue(value) : whole
    }),
  )
}

interface Before {
  state: GraphState | null
  action: string
  move?: Move
  /** The place on the path of the state it left from, when that state is on it. */
  fromStep?: number
}

function beforeOf(graph: StateGraph, run: ProofRun, picked: GraphState, step: number | null): Before {
  if (step != null) {
    if (step === 0) return { state: null, action: 'Init' }
    return { state: graph.nodes.get(graph.path[step - 1]!) ?? null, action: run.trace?.[step]?.action ?? graph.pathMoves[step - 1]!.action }
  }
  const into = graph.into.get(picked.id) ?? []
  const fromPath = into
    .map((move) => ({ move, at: graph.path.indexOf(move.from) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at)[0]
  const move = fromPath?.move ?? into[0]
  if (!move) return { state: null, action: 'Init' }
  return { state: graph.nodes.get(move.from) ?? null, action: move.action, move, ...(fromPath ? { fromStep: fromPath.at } : {}) }
}

/**
 * A state's values as text: `head[i1]` for each key of a function or record when `byKey`, else each variable whole.
 * A variable without keys is always whole.
 */
function readings(vars: StateVars, byKey = true): Map<string, string> {
  const read = new Map<string, string>()
  for (const { name, value } of vars) {
    const keys = byKey ? keysOf(value) : null
    if (!keys) {
      read.set(name, formatValue(value))
      continue
    }
    for (const key of keys) read.set(`${name}[${key}]`, formatValue(lensValue(vars, { variable: name, key })!))
  }
  return read
}

/** The keys that changed from one state to the next, in any variable. */
function changedKeys(before: StateVars, after: StateVars): Set<string> {
  const keys = new Set<string>()
  for (const { name, value } of after) {
    const old = before.find((entry) => entry.name === name)?.value
    for (const key of keysOf(value) ?? []) {
      const [now, was] = [lensValue(after, { variable: name, key }), old ? lensValue(before, { variable: name, key }) : undefined]
      if (!was || !now || formatValue(now) !== formatValue(was)) keys.add(key)
    }
  }
  return keys
}

function storyOf(words: string | undefined, before: Before, vars: StateVars): string {
  const lead = before.fromStep != null ? `From state ${before.fromStep + 1}.` : ''
  if (!before.state) return [lead, words ?? 'Where every run starts.'].filter(Boolean).join(' ')
  const [was, now] = [readings(before.state.vars), readings(vars)]
  const changes = [...now].filter(([name, text]) => was.get(name) !== text).map(([name, text]) => ({ name, from: was.get(name) ?? '—', to: text }))
  let said: string
  if (changes.length === 0) said = 'Nothing changes.'
  else {
    const [first, ...rest] = changes
    const named = rest.slice(0, NAMED_CHANGES - 1).map((change) => `${change.name} from ${change.from} to ${change.to}`)
    const more = rest.length - named.length
    const tail = [...named, ...(more > 0 ? [`${more} more ${more === 1 ? 'changes' : 'change'}`] : [])]
    said = `Here ${first!.name} goes from ${first!.from} to ${first!.to}${tail.length === 0 ? '' : tail.length === 1 ? `, and ${tail[0]}` : `, ${tail.slice(0, -1).join(', ')}, and ${tail.at(-1)}`}.`
  }
  return [lead, words, said].filter(Boolean).join(' ')
}

interface RuleReading {
  rule: ProofRule | undefined
  body: string
  /** The variables it requires, which are red where it breaks. */
  required: Set<string>
  /** The key the counterexample is about: the one its last move changed, when it changed one. */
  focus: string | null
  /** The keys red where it breaks. */
  culprits: Set<string> | null
}

function readRule(run: ProofRun, graph: StateGraph, names: ReadonlySet<string>): RuleReading {
  const rule = run.rules.find((entry) => entry.name === run.broken)
  const definition = rule ? run.definitions.find((entry) => entry.name === rule.name) : undefined
  const body = definition ? bodyOf(definition.lines) : ''
  const required = namedIn(requiredPart(body), names)
  const all = namedIn(body, names)
  const last = graph.path.at(-1)
  const previous = graph.path.at(-2)
  const culprits = graph.broken && last && previous ? changedKeys(graph.nodes.get(previous)!.vars, graph.nodes.get(last)!.vars) : null
  return {
    rule,
    body,
    required: new Set(required.length > 0 ? required : all.length > 0 ? all : names),
    focus: culprits?.size === 1 ? [...culprits][0]! : null,
    culprits: culprits && culprits.size > 0 ? culprits : null,
  }
}

function verdictOf(run: ProofRun, graph: StateGraph, reading: RuleReading, vars: StateVars, step: number | null, names: ReadonlySet<string>): Verdict {
  if (!graph.broken) {
    const formula = run.rules
      .filter((rule) => rule.kind === 'invariant')
      .map((rule) => rule.name)
      .join(' ∧ ')
    if (run.outcome === 'holds') return { tone: 'ok', title: 'Every rule holds here', formula, words: 'TLC checked every state of this model, and each rule held in all of them.' }
    return { tone: 'plain', title: 'Checked so far', formula, words: 'TLC has not found a state that breaks a rule.' }
  }
  const atBreak = step === graph.path.length - 1
  const { rule } = reading
  if (!rule) return { tone: atBreak ? 'bad' : 'plain', title: atBreak ? 'This is where it breaks' : 'Still true here', formula: run.broken ?? '', words: '' }
  if (rule.kind === 'deadlock') {
    return atBreak
      ? { tone: 'bad', title: 'Nothing can happen next', formula: '¬ENABLED Next', words: 'TLC checks that some action can always run. In this state none can.' }
      : { tone: 'plain', title: 'Something can still happen', formula: 'ENABLED Next', words: 'Step on to see where it gets stuck.' }
  }
  if (rule.kind === 'property') {
    return atBreak
      ? { tone: 'bad', title: 'The property fails on this run', formula: reading.body || rule.name, words: rule.words ?? 'TLC found a run along which this does not hold.' }
      : { tone: 'plain', title: 'On the way', formula: reading.body || rule.name, words: 'A property is about the whole run, so it fails only at its end.' }
  }
  const formula = instantiate(reading.body || rule.name, reading.focus)
  if (atBreak) {
    const values = reading.body ? valued(requiredPart(formula), vars, names) : ''
    return { tone: 'bad', title: 'This is where it breaks', formula: values ? `${formula}   is   ${values}   FALSE` : formula, words: rule.words ?? `${rule.name} does not hold in this state.` }
  }
  if (step != null) return { tone: 'plain', title: 'Still true here', formula, words: 'It holds in this state. Step on to see what changes.' }
  return { tone: 'plain', title: 'Holds here', formula, words: 'TLC checked this state too, and the rule held.' }
}

export function stateFacts(run: ProofRun, graph: StateGraph, picked: Picked): StateFacts {
  const state = graph.nodes.get(picked.id)
  const found = picked.step ?? graph.path.indexOf(picked.id)
  const step = found >= 0 && graph.path[found] === picked.id ? found : null
  const vars = state?.vars ?? []
  const names = new Set(vars.map((entry) => entry.name))
  const before = state ? beforeOf(graph, run, state, step) : { state: null, action: 'Init' }
  const definition = run.definitions.find((entry) => entry.name === actionName(before.action))
  const code = (step != null ? run.trace?.[step]?.code : undefined) ?? run.actions.find((action) => action.name === actionName(before.action))?.code ?? definition?.code

  const keyed = vars.filter((entry) => keysOf(entry.value))
  const keys = unique(keyed.flatMap((entry) => keysOf(entry.value)!))
  const perKey = keyed.length > 0 && keys.length <= KEY_COLUMNS
  const reading = readRule(run, graph, names)
  const atBreak = graph.broken && step === graph.path.length - 1
  // A key the counterexample never moves played no part in it.
  const moving = new Set(graph.path.slice(1).flatMap((id, index) => [...changedKeys(graph.nodes.get(graph.path[index]!)!.vars, graph.nodes.get(id)!.vars)]))
  const was = before.state ? readings(before.state.vars, perKey) : null
  const cell = (at: string, text: string, breaks: boolean, quiet: boolean, span?: number): Cell => {
    const old = was?.get(at)
    const changed = old != null && old !== text
    return { text, ...(changed ? { was: old } : {}), changed, breaks, quiet, ...(span && span > 1 ? { span } : {}) }
  }

  const rows = vars.map(({ name, value }): Row => {
    const required = atBreak && reading.required.has(name)
    if (!perKey || !keysOf(value)) return { name, cells: [cell(name, formatValue(value), required, false, perKey ? keys.length : undefined)] }
    return {
      name,
      cells: keys.map((key) => {
        const at = lensValue(vars, { variable: name, key })
        return cell(`${name}[${key}]`, at ? formatValue(at) : '—', required && (reading.culprits?.has(key) ?? true), step != null && graph.path.length > 1 && !moving.has(key))
      }),
    }
  })

  return {
    title: step != null ? `State ${step + 1} of ${graph.path.length}` : state?.initial ? 'A starting state' : 'Another state',
    action: before.action,
    ...(code ? { code } : {}),
    story: storyOf(definition?.words, before, vars),
    columns: perKey ? keys : ['Value'],
    rows,
    verdict: verdictOf(run, graph, reading, vars, step, names),
  }
}

/** How many steps the step bar shows at once. */
export const STEP_SLOTS = 6

/** The steps the bar shows: at most six, moved only as far as needed to keep the current one in them. */
export function stepWindow(length: number, current: number, from: number): { from: number; to: number } {
  const size = Math.min(STEP_SLOTS, length)
  let start = from
  if (current < start) start = current
  if (current >= start + size) start = current - size + 1
  start = Math.max(0, Math.min(start, length - size))
  return { from: start, to: start + size }
}
