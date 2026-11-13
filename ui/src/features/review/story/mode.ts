/**
 * How the review is walked (the user, 2026-11-13: "a Free Roam mode, like Free Roam | Story"). In Story the reviewer
 * walks the story's steps and the graph follows each one. In Free Roam nothing leads: no step drives the focus or the
 * camera, and the reviewer moves between nodes as they like, each focused alone (`focusNode` with `alone`). Each mode
 * has its key, and choosing one, either way, starts it from the beginning. The mode chosen last is remembered in the
 * window (`memory.ts`). Pure, so it is tested without a screen. See _specs/032-change-review.
 */
import type { Review } from '#shared/review/types.ts'
import { goToStep, leaveFocus, type Moved, type StoryState } from './story.ts'

export type ReviewMode = 'story' | 'roam'

/** Each mode's key, side by side on the keyboard as the two are on the switch: Free Roam, then Story, the path. */
export const MODE_KEYS: Record<ReviewMode, string> = { roam: 'O', story: 'P' }

/** The mode a key chooses, or null for any other key. */
export function modeOfKey(key: string): ReviewMode | null {
  const pressed = key.toUpperCase()
  return pressed === MODE_KEYS.roam ? 'roam' : pressed === MODE_KEYS.story ? 'story' : null
}

/** A saved mode as the window reads it back: anything but Free Roam, an older window's nothing among it, is Story. */
export const readMode = (value: unknown): ReviewMode => (value === 'roam' ? 'roam' : 'story')

type Story = Pick<Review, 'story' | 'nodes' | 'edges'>

/**
 * Where a mode starts. Story is at its first step, framed as a step is. Free Roam has the whole graph in view and
 * nothing in focus. What the reviewer has seen, and what has drawn in, stays.
 */
export function modeStart(review: Story, state: StoryState, mode: ReviewMode): Moved {
  if (mode === 'story') return goToStep(review, state, 0)
  return { state: leaveFocus(review, state), fresh: { nodes: [], wires: [] } }
}
