/**
 * The step pager at the bottom of the canvas: where the reviewer is in the story, a position for every step, and the
 * way one step back or on. Pure, so what it says and what it allows can be tested without drawing it.
 */
import type { StoryStep } from '#shared/review/types.ts'
import type { StoryState } from './story.ts'

export interface PagerInput {
  steps: readonly Pick<StoryStep, 'id' | 'title'>[]
  /** The current step, or the one to come back to while the reviewer is off the path. */
  step: number
  seen: readonly string[]
  /** The reviewer is looking at something other than the step: a node, a unit or the whole graph. */
  away: boolean
  /** Digits typed toward a step number, while they wait for a second one. */
  pending: string
}

export interface PagerPosition {
  index: number
  title: string
  current: boolean
  seen: boolean
}

export interface Pager {
  /** "Step 3 of 6", or the number being typed. */
  label: string
  positions: PagerPosition[]
  away: boolean
  /** There is a step to go back to, or a way back onto the path. */
  back: boolean
  /** There is a step to go on to, or a way back onto the path. */
  next: boolean
}

/** Off the path: a node or a unit focused outside the story, or the whole graph. */
export function awayFrom(story: Pick<StoryState, 'detour' | 'group' | 'whole'>): boolean {
  return story.detour != null || story.group != null || story.whole
}

export function pagerOf({ steps, step, seen, away, pending }: PagerInput): Pager {
  const last = steps.length - 1
  return {
    label: pending ? `Go to ${pending}…` : `Step ${step + 1} of ${steps.length}`,
    positions: steps.map((entry, index) => ({ index, title: entry.title, current: index === step, seen: seen.includes(entry.id) })),
    away,
    // Off the path both ways lead back onto it: back to the step it left, on to the one after.
    back: step > 0 || away,
    next: step < last || away,
  }
}
