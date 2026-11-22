import { create } from 'zustand'
import type { Picked } from './graph/step.ts'

/**
 * What the proof views keep for each run while the app is open (053-work-control-room, "Proofs"): the tab, the picked
 * state, the graph's view, lens and search, the math's mode, block and step, where F last went, and where an opener
 * asked the run to land. Opening a run again, switching tabs or coming back with J and K shows it as it was left.
 * Also the siblings the last opener named. Nothing is saved: a new launch starts fresh.
 */

export type ProofTab = 'run' | 'graph' | 'math'
export type GraphShows = 'path' | 'around' | 'grouped'
export type MathMode = 'math' | 'words' | 'both'
/** Where an opener asks a run to open: at the proof tree's first step that failed, or at the trace's break. */
export type Landing = 'proof' | 'break'

export interface KeptGraph {
  /** The view the user chose. Null shows the counterexample when there is one, else the states by a variable. */
  view: GraphShows | null
  lens: string | null
  query: string
  /** The picked state. Null picks where the run broke, or a state the model starts in. */
  picked: Picked | null
}

export interface KeptMath {
  mode: MathMode
  /** The picked definition. Undefined picks the first that matters; null is none. */
  block?: string | null
  /** The picked proof step, by its place in the tree. */
  step: number | null
  /** Every step of the tree shows, the proved ones too. */
  all: boolean
}

export interface KeptRun {
  tab: ProofTab
  graph: KeptGraph
  math: KeptMath
  /** The failure F went to last, by its place among the run's failures. */
  failure: number | null
  /** Where to land once the whole run is here. */
  landing: Landing | null
}

export const FRESH: KeptRun = {
  tab: 'run',
  graph: { view: null, lens: null, query: '', picked: null },
  math: { mode: 'math', step: null, all: false },
  failure: null,
  landing: null,
}

/** Runs kept at most. The oldest leave first. */
const MOST = 60

interface ProofMemory {
  runs: Record<string, KeptRun>
  /** The runs the last opener named, in the order it showed them. */
  siblings: readonly string[]
}

// The window's one store lives on globalThis, so a hot update of this file finds it instead of starting an empty one.
const holder = globalThis as { __hobkinProofMemory?: ReturnType<typeof makeMemory> }
function makeMemory() {
  return create<ProofMemory>()(() => ({ runs: {}, siblings: [] }))
}
export const useProofMemory = (holder.__hobkinProofMemory ??= makeMemory())

export const keptOf = (id: string | null | undefined): KeptRun => (id ? useProofMemory.getState().runs[id] : undefined) ?? FRESH

/** One part of a run's kept state, drawn again only when that part changes. */
export function useKept<Part extends keyof KeptRun>(id: string, part: Part): KeptRun[Part] {
  return useProofMemory((memory) => (memory.runs[id] ?? FRESH)[part])
}

/** Changes what a run keeps. A part left out keeps its object. */
export function keep(id: string, change: Partial<KeptRun> | ((kept: KeptRun) => KeptRun)): void {
  const { runs } = useProofMemory.getState()
  const before = runs[id] ?? FRESH
  const after = typeof change === 'function' ? change(before) : { ...before, ...change }
  if (after === before) return

  // The run just changed goes last, so the ones left untouched longest are the first to leave.
  const { [id]: _left, ...others } = runs
  useProofMemory.setState({ runs: { ...newestOf(others, MOST - 1), [id]: after } })
}

/** The last `count` runs of `runs`, in their order. */
function newestOf(runs: Record<string, KeptRun>, count: number): Record<string, KeptRun> {
  const ids = Object.keys(runs)
  if (ids.length <= count) return runs
  return Object.fromEntries(ids.slice(ids.length - count).map((id) => [id, runs[id]!]))
}

export const keepGraph = (id: string, patch: Partial<KeptGraph>) => keep(id, (kept) => ({ ...kept, graph: { ...kept.graph, ...patch } }))
export const keepMath = (id: string, patch: Partial<KeptMath>) => keep(id, (kept) => ({ ...kept, math: { ...kept.math, ...patch } }))

/** The siblings the opener named, for the page to move among with J and K. */
export function nameSiblings(ids: readonly string[]): void {
  const now = useProofMemory.getState().siblings
  if (now.length === ids.length && now.every((id, index) => id === ids[index])) return
  useProofMemory.setState({ siblings: [...ids] })
}
