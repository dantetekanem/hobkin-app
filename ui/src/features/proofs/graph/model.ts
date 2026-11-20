/**
 * The state graph's three views as pictures to draw (_specs/050-tla-proofs, "The state graph"):
 *
 * - **The counterexample**: the shortest path TLC found, with the other moves from the same states faded.
 * - **Around it**: the states within two steps of the path, at most 200, saying how many of how many it shows.
 * - **By a variable**: every state grouped by one variable, which draws the machine the code has without saying so,
 *   with each action's count on its arrow and an action that never fired dashed.
 *
 * The graph comes from TLC's dump when the model was small enough, else from the counterexample alone. Pure, so the
 * tests run it with Node alone; layout and drawing are elsewhere.
 */
import type { ProofAction, ProofRun } from '#shared/protocol/proofs.ts'
import { actionName, changedKeys, count, formatValue, lensValue, lensesOf, stateKey, type Lens, type StateVars } from './values.ts'

export interface GraphState {
  id: string
  initial: boolean
  vars: StateVars
}

export interface Move {
  from: string
  to: string
  action: string
}

export interface StateGraph {
  nodes: Map<string, GraphState>
  out: Map<string, Move[]>
  into: Map<string, Move[]>
  /** The counterexample's states, in order. Empty when there is none. */
  path: string[]
  /** The move into each state of the path after the first, in the trace's own words: `Fix(i1)`. */
  pathMoves: Move[]
  /**
   * Each step of the path as the views name it: `Init`, then the move into it. TLC 1.7.4 names a move without its
   * arguments, so a bare name gets the keys the move changed: `Fix · i1`.
   */
  stepWords: string[]
  /** The run broke, and the path's last state is where. */
  broken: boolean
  /** TLC dumped the graph. Without it, the graph is the counterexample alone. */
  dumped: boolean
  /** Why there is no dump, in a sentence: hobkin's note, or a plain default. Null with a dump. */
  why: string | null
  /** Distinct states in the whole model. */
  total: number
}

export type NodeLook = 'step' | 'side' | 'near' | 'group' | 'ghost'
export type EdgeLook = 'path' | 'side' | 'near' | 'group'

export interface PictureNode {
  id: string
  look: NodeLook
  text: string
  /** The graph's states it stands for: one, or every state of a group. */
  states: string[]
  /** Its place on the counterexample, when it is on it. */
  step?: number
  breaks?: boolean
  width: number
  height: number
  aria: string
}

export interface EdgeLabel {
  text: string
  breaks?: boolean
}

export interface PictureEdge {
  id: string
  from: string
  to: string
  look: EdgeLook
  labels: EdgeLabel[]
  breaks?: boolean
  /** A move that keeps its state, or the grouped value, draws as a loop on its node. */
  loop?: boolean
}

export interface Picture {
  nodes: PictureNode[]
  edges: PictureEdge[]
  /** One or two lines under the canvas: what it shows, and how much of the model. */
  note: string
}

/** The other moves the counterexample shows from each of its states. */
export const SIDES = 3
/** States around the path, at most. */
export const AROUND = 200
/** Wires around the path, at most: the path first, then the way each state was found. */
const AROUND_WIRES = 600
/** Groups of one variable's values, at most: the biggest ones. */
export const GROUPS = 40

const unique = <Value>(values: Iterable<Value>) => [...new Set(values)]
const push = <Key, Value>(map: Map<Key, Value[]>, key: Key, value: Value) => map.set(key, [...(map.get(key) ?? []), value])

const NO_DUMP = "TLC did not dump this model's graph."

/** A move's name with the keys it changed when TLC gave it no arguments, so `Fix` and `Fix` read apart. */
function moveWords(action: string, before: StateVars, after: StateVars): string {
  if (action.includes('(')) return action
  const keys = [...changedKeys(before, after)]
  return keys.length > 0 && keys.length <= 2 ? `${action} · ${keys.join(', ')}` : action
}

export function stateGraph(run: Pick<ProofRun, 'graph' | 'graphNote' | 'trace' | 'stats' | 'outcome'>): StateGraph {
  const nodes = new Map<string, GraphState>()
  const byKey = new Map<string, string>()
  const moves: Move[] = []
  const seen = new Set<string>()
  const addMove = (move: Move) => {
    const id = `${move.from}>${move.to}:${move.action}`
    if (seen.has(id)) return
    seen.add(id)
    moves.push(move)
  }

  for (const node of run.graph?.nodes ?? []) {
    nodes.set(node.id, { id: node.id, initial: node.initial, vars: node.vars })
    byKey.set(stateKey(node.vars), node.id)
  }
  for (const edge of run.graph?.edges ?? []) if (nodes.has(edge.from) && nodes.has(edge.to)) addMove({ from: edge.from, to: edge.to, action: edge.action })

  const trace = run.trace ?? []
  const path = trace.map((state, index) => {
    const key = stateKey(state.vars)
    const known = byKey.get(key)
    if (known) return known
    const id = `trace:${state.n}`
    nodes.set(id, { id, initial: index === 0, vars: state.vars })
    byKey.set(key, id)
    return id
  })
  const pathMoves = path.slice(1).map((to, index) => ({ from: path[index]!, to, action: trace[index + 1]!.action }))
  // A move of the counterexample the dump lacks, or every one of them without a dump, so each view can draw the path.
  for (const move of pathMoves) if (!moves.some((known) => known.from === move.from && known.to === move.to)) addMove({ ...move, action: actionName(move.action) })

  const out = new Map<string, Move[]>()
  const into = new Map<string, Move[]>()
  for (const move of moves) {
    push(out, move.from, move)
    push(into, move.to, move)
  }
  const dumped = (run.graph?.nodes.length ?? 0) > 0
  const note = run.graphNote?.trim()
  return {
    nodes,
    out,
    into,
    path,
    pathMoves,
    stepWords: path.map((id, index) => (index === 0 ? 'Init' : moveWords(trace[index]!.action, nodes.get(path[index - 1]!)!.vars, nodes.get(id)!.vars))),
    broken: run.outcome === 'broken' && path.length > 0,
    dumped,
    why: dumped ? null : note ? (/[.!?]$/.test(note) ? note : `${note}.`) : NO_DUMP,
    total: Math.max(nodes.size, run.graph?.total ?? run.stats.distinct),
  }
}

const STEP = 44
const SMALL_STEP = 30
const SIDE = 26
const NEAR = 16
/** Group pills fit their value in 13px mono, a char about 7.8px wide. */
const pill = (text: string, char: number, least: number) => ({ width: Math.round(Math.min(240, Math.max(least, text.length * char + 36))), height: 46 })

function stepNode(graph: StateGraph, id: string, index: number, size: number): PictureNode {
  const action = index > 0 ? graph.pathMoves[index - 1]!.action : null
  return {
    id,
    look: 'step',
    text: String(index + 1),
    states: [id],
    step: index,
    breaks: graph.broken && index === graph.path.length - 1,
    width: size,
    height: size,
    aria: `State ${index + 1}, ${action ? `after ${action}` : 'where it starts'}`,
  }
}

/** Each state of the path once, with its first place on it. A path that comes back to a state draws a wire back. */
function pathNodes(graph: StateGraph, size: number): PictureNode[] {
  const nodes = new Map<string, PictureNode>()
  graph.path.forEach((id, index) => {
    if (!nodes.has(id)) nodes.set(id, stepNode(graph, id, index, size))
  })
  return [...nodes.values()]
}

function pathEdges(graph: StateGraph): PictureEdge[] {
  return graph.pathMoves.map((move, index) => {
    const breaks = graph.broken && index === graph.pathMoves.length - 1
    return { id: `path:${index + 1}`, from: move.from, to: move.to, look: 'path', labels: [{ text: graph.stepWords[index + 1]!, breaks }], breaks, ...(move.from === move.to ? { loop: true } : {}) }
  })
}

export function pathPicture(graph: StateGraph, { sides = SIDES }: { sides?: number } = {}): Picture {
  const nodes = pathNodes(graph, STEP)
  const edges = pathEdges(graph)
  const placed = new Set(nodes.map((node) => node.id))
  let capped = false
  // The last state is where it broke: what TLC could do after it is beside the point.
  graph.path.slice(0, -1).forEach((id, index) => {
    const next = graph.path[index + 1]
    const others = (graph.out.get(id) ?? []).filter((move) => move.to !== next)
    if (others.length > sides) capped = true
    for (const move of others.slice(0, sides)) {
      if (!placed.has(move.to)) {
        placed.add(move.to)
        nodes.push({ id: move.to, look: 'side', text: '', states: [move.to], width: SIDE, height: SIDE, aria: `Another state, after ${move.action}` })
      }
      edges.push({ id: `side:${move.from}>${move.to}:${move.action}`, from: move.from, to: move.to, look: 'side', labels: [{ text: move.action }] })
    }
  })
  const lead = graph.broken ? 'The shortest path to a broken state.' : 'The path TLC printed.'
  const note = graph.why ? `${lead} No other moves are shown: ${graph.why}` : `${lead} Faded: other moves from the same states.${capped ? ` At most ${sides} from each.` : ''}`
  return { nodes, edges, note }
}

/** Where to look around: the path, or the states the model starts in when there is no counterexample. */
function seedsOf(graph: StateGraph): { ids: string[]; words: string } {
  if (graph.path.length > 0) return { ids: unique(graph.path), words: 'the path' }
  const initial = [...graph.nodes.values()].filter((node) => node.initial).map((node) => node.id)
  return { ids: initial.length > 0 ? initial : [...graph.nodes.keys()].slice(0, 1), words: 'the start' }
}

/** States in order of their distance from the seeds, either way along a move, up to `radius` steps. */
function within(graph: StateGraph, seeds: readonly string[], radius: number): string[] {
  const depth = new Map(seeds.map((id) => [id, 0]))
  const order = [...seeds]
  for (let index = 0; index < order.length; index++) {
    const id = order[index]!
    const at = depth.get(id)!
    if (at >= radius) continue
    for (const move of [...(graph.out.get(id) ?? []), ...(graph.into.get(id) ?? [])]) {
      const next = move.from === id ? move.to : move.from
      if (depth.has(next)) continue
      depth.set(next, at + 1)
      order.push(next)
    }
  }
  return order
}

export interface AroundOptions {
  radius?: number
  cap?: number
  /** A search: show the states it found instead of the neighborhood. */
  match?: { ids: ReadonlySet<string>; text: string }
}

export function aroundPicture(graph: StateGraph, { radius = 2, cap = AROUND, match }: AroundOptions = {}): Picture {
  const seeds = seedsOf(graph)
  const matches = match ? [...graph.nodes.keys()].filter((id) => match.ids.has(id)) : []
  const shown = (match ? unique([...seeds.ids, ...matches]) : within(graph, seeds.ids, radius)).slice(0, cap)
  const chosen = new Set(shown)
  const stepOf = new Map<string, number>()
  graph.path.forEach((id, index) => {
    if (!stepOf.has(id)) stepOf.set(id, index)
  })

  const nodes = shown.map((id): PictureNode => {
    const step = stepOf.get(id)
    if (step != null) return stepNode(graph, id, step, SMALL_STEP)
    return { id, look: 'near', text: '', states: [id], width: NEAR, height: NEAR, aria: graph.nodes.get(id)?.initial ? 'A state the model starts in' : 'A nearby state' }
  })
  // So many states leave no room to name each move: the path's moves are named on the step bar.
  const edges: PictureEdge[] = pathEdges(graph).map((edge) => ({ ...edge, labels: [] }))
  const drawn = new Set(edges.map((edge) => `${edge.from}>${edge.to}`))
  for (const id of shown) {
    for (const move of graph.out.get(id) ?? []) {
      const pair = `${move.from}>${move.to}`
      if (edges.length >= AROUND_WIRES) break
      if (drawn.has(pair) || !chosen.has(move.to) || move.from === move.to) continue
      drawn.add(pair)
      edges.push({ id: `near:${pair}`, from: move.from, to: move.to, look: 'near', labels: [{ text: move.action }] })
    }
  }

  const total = count(graph.total)
  let note: string
  if (match) {
    const found = matches.filter((id) => chosen.has(id)).length
    note = `Showing ${count(found)} of ${count(matches.length)} states where ${match.text}, with ${seeds.words}.`
  } else if (graph.why) {
    note = `Showing ${count(shown.length)} of ${total} states: the counterexample's only. ${graph.why}`
  } else {
    note = `Showing ${count(shown.length)} of ${total} states: those within ${radius} steps of ${seeds.words}.${shown.length < graph.total ? ' Search to find others.' : ''}`
  }
  return { nodes, edges, note }
}

interface Group {
  key: string
  states: string[]
  steps: number[]
}

/**
 * The lens the grouped view starts with: the one whose value changes most along the counterexample, else the first
 * that splits the model into a few groups, else the first. Null when there is no state at all.
 */
export function defaultLens(graph: StateGraph): Lens | null {
  const first = graph.nodes.values().next().value
  if (!first) return null
  const lenses = lensesOf(first.vars)
  const valueAt = (id: string, lens: Lens) => {
    const value = lensValue(graph.nodes.get(id)!.vars, lens)
    return value ? formatValue(value) : ''
  }
  if (graph.path.length > 1) {
    const changes = lenses.map((lens) => graph.path.slice(1).filter((id, index) => valueAt(id, lens) !== valueAt(graph.path[index]!, lens)).length)
    const most = Math.max(...changes)
    if (most > 0) return lenses[changes.indexOf(most)]!
  }
  const sample = [...graph.nodes.keys()].slice(0, 5000)
  return lenses.find((lens) => new Set(sample.map((id) => valueAt(id, lens))).size >= 2 && new Set(sample.map((id) => valueAt(id, lens))).size <= 12) ?? lenses[0] ?? null
}

export function groupedPicture(graph: StateGraph, lens: Lens, actions: readonly ProofAction[] = [], { cap = GROUPS }: { cap?: number } = {}): Picture {
  const groups = new Map<string, Group>()
  const groupOf = new Map<string, string>()
  for (const node of graph.nodes.values()) {
    const value = lensValue(node.vars, lens)
    const key = value ? formatValue(value) : '—'
    groupOf.set(node.id, key)
    if (!groups.has(key)) groups.set(key, { key, states: [], steps: [] })
    groups.get(key)!.states.push(node.id)
  }
  graph.path.forEach((id, index) => groups.get(groupOf.get(id)!)!.steps.push(index))

  const all = [...groups.values()]
  const kept = new Set(
    all.length <= cap
      ? all.map((group) => group.key)
      : [...all]
          .sort((a, b) => b.states.length - a.states.length)
          .slice(0, cap)
          .map((group) => group.key),
  )
  const last = graph.path.at(-1)
  const breakingGroup = graph.broken && last ? groupOf.get(last) : undefined
  const nodes = all
    .filter((group) => kept.has(group.key))
    .map(
      (group): PictureNode => ({
        id: group.key,
        look: 'group',
        text: group.key,
        states: group.states,
        ...(group.steps.length > 0 ? { step: group.steps[0] } : {}),
        breaks: group.key === breakingGroup,
        ...pill(group.key, 7.8, 96),
        aria: `${count(group.states.length)} ${group.states.length === 1 ? 'state' : 'states'} where ${lens.label} = ${group.key}`,
      }),
    )

  // Each pair of groups, and the actions between them with how often each moved a state from one to the other.
  const breakingMove = graph.broken ? graph.pathMoves.at(-1) : undefined
  const between = new Map<string, { from: string; to: string; byAction: Map<string, { times: number; breaks: boolean }> }>()
  for (const moves of graph.out.values()) {
    for (const move of moves) {
      const [from, to] = [groupOf.get(move.from)!, groupOf.get(move.to)!]
      if (!kept.has(from) || !kept.has(to)) continue
      const pair = `${from}>${to}`
      const { byAction } = between.get(pair) ?? between.set(pair, { from, to, byAction: new Map() }).get(pair)!
      const name = actionName(move.action)
      const known = byAction.get(name) ?? { times: 0, breaks: false }
      byAction.set(name, { times: known.times + 1, breaks: known.breaks || (move.from === breakingMove?.from && move.to === breakingMove.to) })
    }
  }
  const labelOf = ([name, { times, breaks }]: [string, { times: number; breaks: boolean }]): EdgeLabel => ({
    text: [name, ...(graph.dumped ? [count(times)] : []), ...(breaks ? ['breaks'] : [])].join(' · '),
    breaks,
  })
  const edges: PictureEdge[] = []
  for (const [pair, { from, to, byAction }] of between) {
    const labels = [...byAction].map(labelOf)
    const breaks = labels.some((label) => label.breaks)
    edges.push(from === to ? { id: `${pair}:loop`, from, to, look: 'group', labels, breaks, loop: true } : { id: pair, from, to, look: 'group', labels, breaks })
  }

  const silent = actions.filter((action) => action.count === 0)
  for (const action of silent) {
    const text = `${action.name} · never fired`
    nodes.push({ id: `ghost:${action.name}`, look: 'ghost', text, states: [], ...pill(text, 6.9, 120), height: 34, aria: `${action.name} never fired, so nothing it guards was checked` })
  }

  const notes = [`Every state, grouped by ${lens.label}. This is the machine the code has without saying so.`]
  if (kept.size < groups.size) notes.push(`Showing the ${cap} biggest of ${count(groups.size)} values.`)
  if (graph.why) notes.push(`Only the counterexample's states. ${graph.why}`)
  if (silent.length > 0) notes.push('Dashed: never fired, so nothing it guards was checked.')
  return { nodes, edges, note: notes.join(' ') }
}
