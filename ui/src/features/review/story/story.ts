/**
 * Where the reviewer is in the story: the step, what they have seen, what has drawn in, and whether they
 * stepped off the path. Pure functions over a small state, so the walk can be tested without a screen.
 */
import type { Review, ReviewEdge } from '#shared/review/types.ts'
import { focusLevels } from '../graph/levels.ts'
import type { StoredProgress } from '../state/memory.ts'

export interface StoryState {
  /** Index of the current step. Off the path, this is the step to come back to. */
  step: number
  /** Ids of the steps seen, in the order they were first seen. */
  seen: string[]
  /** Ids of the nodes and wires that have drawn in. On later visits they are already there. */
  revealed: string[]
  /** A node focused outside the story, by a click or by the keyboard. */
  detour: string | null
  /** Several nodes focused outside the story at once: those a unit of the change review tells. */
  group: string[] | null
  /** Focus was left for the whole graph. */
  whole: boolean
}

/** What draws in on arriving somewhere for the first time. */
export interface Fresh {
  nodes: string[]
  /** Each new wire, and the end it grows from: the end that was already on screen. */
  wires: { id: string; from: 'source' | 'target' }[]
}

export interface Moved {
  state: StoryState
  fresh: Fresh
}

type Story = Pick<Review, 'story' | 'nodes' | 'edges'>

const NOTHING: Fresh = { nodes: [], wires: [] }
const clampStep = (review: Story, index: number) => Math.max(0, Math.min(review.story.length - 1, Math.trunc(index) || 0))
const unique = <Value>(values: readonly Value[]) => [...new Set(values)]

/**
 * The nodes a step is told beside: its own, or, for a step after the opening that has none, the nearest step's: the
 * one before it, else the one after. So the camera stays where the walk is, and only the opening shows the whole
 * graph. What the step shows stays its own: this is only where it is told.
 */
export function besideOf(review: Pick<Review, 'story'>, index: number): string[] {
  const own = review.story[index]?.focus ?? []
  if (own.length > 0 || index <= 0) return own
  const near = (from: number, by: number) => {
    for (let at = from; at > 0 && at < review.story.length; at += by) if (review.story[at]!.focus.length > 0) return review.story[at]!.focus
    return null
  }
  return near(index - 1, -1) ?? near(index + 1, 1) ?? []
}

/** The nodes in focus now: the detour or the group, nothing for the whole graph, or what the current step is told beside. */
export function focusOf(review: Story, state: StoryState): string[] {
  if (state.whole) return []
  if (state.detour != null) return [state.detour]
  if (state.group) return state.group
  return besideOf(review, state.step)
}

/** True when the reviewer is looking at something other than the current step: "Back to step N" is offered. */
export function offPath(review: Story, state: StoryState): boolean {
  return state.detour != null || state.group != null || (state.whole && besideOf(review, state.step).length > 0)
}

/**
 * Marks what a focus puts on screen as drawn in, and says which of it is new: the focus, and the wires and neighbors it
 * draws. What it folds away is not on screen with it, so it does not draw in.
 */
function reveal(review: Story, revealed: readonly string[], focus: readonly string[]): { revealed: string[]; fresh: Fresh } {
  if (focus.length === 0) return { revealed: [...revealed], fresh: NOTHING }
  const before = new Set(revealed)
  const focused = new Set(focus)
  const levels = focusLevels(review, focus)
  const drawn = review.edges.filter((edge) => levels.wires[edge.id] === 'bright' || levels.wires[edge.id] === 'near')

  const nodes = [...focus.filter((id) => !before.has(id)), ...review.nodes.map((node) => node.id).filter((id) => levels.nodes[id] === 'neighbor' && !before.has(id))]
  const wires = drawn.filter((edge) => !before.has(edge.id)).map((edge) => ({ id: edge.id, from: growsFrom(edge, before, focused) }))
  return { revealed: [...revealed, ...nodes, ...wires.map((wire) => wire.id)], fresh: { nodes, wires } }
}

/** A wire grows from the end that was on screen before. With both or neither, it grows out of the focus. */
function growsFrom(edge: Pick<ReviewEdge, 'from' | 'to'>, before: ReadonlySet<string>, focused: ReadonlySet<string>): 'source' | 'target' {
  const [source, target] = [before.has(edge.from), before.has(edge.to)]
  if (source !== target) return source ? 'source' : 'target'
  return focused.has(edge.from) ? 'source' : 'target'
}

/**
 * Opens the story at its first step, every time (the user, 2026-11-12): a review closed and opened again starts from
 * step 1. What the reviewer saw and what drew in are kept. Only hobkin's cursor or a link names another place
 * (`followCursor`). Saved ids the review no longer has are dropped.
 */
export function startStory(review: Story, saved?: StoredProgress | null): StoryState {
  const stepIds = new Set(review.story.map((step) => step.id))
  const known = new Set([...review.nodes.map((node) => node.id), ...review.edges.map((edge) => edge.id)])
  const step = 0
  const seen = unique((saved?.seen ?? []).filter((id) => stepIds.has(id)))
  const current = review.story[step]?.id
  if (current && !seen.includes(current)) seen.push(current)
  const restored = unique((saved?.revealed ?? []).filter((id) => known.has(id)))
  // The step being opened on is on screen, so it has drawn in.
  return { step, seen, revealed: reveal(review, restored, besideOf(review, step)).revealed, detour: null, group: null, whole: false }
}

/** Moves to a step, back onto the path. */
export function goToStep(review: Story, state: StoryState, index: number): Moved {
  const step = clampStep(review, index)
  const id = review.story[step]!.id
  const { revealed, fresh } = reveal(review, state.revealed, besideOf(review, step))
  return { state: { step, seen: state.seen.includes(id) ? state.seen : [...state.seen, id], revealed, detour: null, group: null, whole: false }, fresh }
}

/**
 * The step a move of `delta` lands on. Off the path, the path is where the reviewer left it:
 * back returns to that step, and forward moves on to the one after.
 */
export function stepFrom(review: Story, state: StoryState, delta: number): number {
  const from = offPath(review, state) && delta < 0 ? state.step + 1 : state.step
  return clampStep(review, from + delta)
}

/**
 * Focuses one node. A node of the current step stays on the path, and any other is a detour. `alone`, as Free Roam
 * asks (`mode.ts`), focuses every node by itself: no step takes the focus back.
 */
export function focusNode(review: Story, state: StoryState, nodeId: string, { alone = false }: { alone?: boolean } = {}): Moved {
  if (!review.nodes.some((node) => node.id === nodeId)) return { state, fresh: NOTHING }
  if (!alone && besideOf(review, state.step).includes(nodeId)) return backToStep(review, state)
  const { revealed, fresh } = reveal(review, state.revealed, [nodeId])
  return { state: { ...state, revealed, detour: nodeId, group: null, whole: false }, fresh }
}

/**
 * Focuses several nodes at once, such as those a unit of the change review tells. One node is a detour like any other,
 * and the current step's own focus is the step itself.
 */
export function focusGroup(review: Story, state: StoryState, nodeIds: readonly string[]): Moved {
  const known = new Set(review.nodes.map((node) => node.id))
  const ids = unique(nodeIds.filter((id) => known.has(id)))
  if (ids.length === 0) return { state, fresh: NOTHING }
  if (ids.length === 1) return focusNode(review, state, ids[0]!)
  const own = besideOf(review, state.step)
  if (own.length === ids.length && ids.every((id) => own.includes(id))) return backToStep(review, state)
  const { revealed, fresh } = reveal(review, state.revealed, ids)
  return { state: { ...state, revealed, detour: null, group: ids, whole: false }, fresh }
}

/** "Back to step N": the remembered step, with its own focus. */
export function backToStep(review: Story, state: StoryState): Moved {
  return goToStep(review, state, state.step)
}

/** Leaves focus for the whole graph. The step is remembered. */
export function leaveFocus(_review: Story, state: StoryState): StoryState {
  return { ...state, detour: null, group: null, whole: true }
}

export function progressOf(review: Story, state: StoryState): StoredProgress {
  return { step: review.story[state.step]?.id ?? '', seen: state.seen, revealed: state.revealed }
}
