import type { FinishedChange } from '#shared/protocol/work.ts'
import { deployOf } from '#shared/review/assessment.ts'
import { layerReviewId } from '../review/stack-strip.ts'
import { GRADE_ORDER } from './projects.ts'
import type { ReviewRow } from './ai-reviews.ts'

/**
 * The story (_specs/064-review-story): the reviews waiting on the user, put in one order when it starts and opened one
 * after the other. Pure, so it is tested without a window.
 */

/** How many reviews waiting on the user make the list offer the story. */
export const STORY_FROM = 10

/** A stack and the place of a review in it, counted from the bottom, which is 1 and lands first. */
export type StackOf = (row: ReviewRow) => { id: string; layer: number } | null

/**
 * Every review waiting on the user: a merge that failed is not one, and neither is a review that stopped. Ready ones
 * first, then those being reviewed, then those waiting their turn, each as the rows came.
 */
export function waitingRows(rows: readonly ReviewRow[]): ReviewRow[] {
  const of = (kind: ReviewRow['state']['kind']) => rows.filter((row) => !row.merge && row.state.kind === kind)
  return [...of('ready'), ...of('reviewing'), ...of('waits')]
}

/** Where a review stands in its stack, read from the finished changes: by the review a layer opens. */
export function stackLookup(changes: readonly FinishedChange[]): StackOf {
  const places = new Map<string, { id: string; layer: number }>()
  for (const change of changes) {
    if (change.stack) places.set(layerReviewId(change), { id: change.stack.id, layer: change.stack.layer })
  }
  return (row) => places.get(row.item.id) ?? null
}

export const offersStory = (rows: readonly ReviewRow[]): boolean => rows.length >= STORY_FROM

/** 0 safe, 1 no answer yet, 2 risky, 3 risky and critical. */
const riskOf = ({ summary }: ReviewRow): number => (!summary ? 1 : deployOf(summary) === 'safe' ? 0 : summary.critical ? 3 : 2)
/** Rated reviews come before those still being prepared or not reviewed yet. */
const tierOf = (row: ReviewRow): number => (row.summary ? 0 : 1)
const priorityOf = ({ priority }: ReviewRow): number => (priority ? GRADE_ORDER[priority] : GRADE_ORDER.P3 + 1)
const sizeOf = ({ item }: ReviewRow): number => item.lines ?? Number.MAX_SAFE_INTEGER

type Key = readonly number[]
function compare(a: Key, b: Key): number {
  const at = a.findIndex((value, place) => value !== b[place])
  return at < 0 ? 0 : a[at]! - b[at]!
}
const keyOf = (row: ReviewRow, index: number): Key => [tierOf(row), priorityOf(row), riskOf(row), sizeOf(row), index]

/**
 * The order of the story: rated reviews before the rest; in each, a stack's layers together, bottom first, at the
 * place of its best layer; then the highest priority (P0 first), the safest, and the smallest change; ties keep the
 * order given.
 */
export function sortStory(rows: readonly ReviewRow[], stackOf: StackOf = () => null): ReviewRow[] {
  type Unit = { key: Key; rows: { row: ReviewRow; layer: number }[] }
  const units: Unit[] = []
  const stacks = new Map<string, Unit>()
  rows.forEach((row, index) => {
    const key = keyOf(row, index)
    const stack = stackOf(row)
    const own = stack ? stacks.get(stack.id) : undefined
    if (own) {
      own.rows.push({ row, layer: stack!.layer })
      if (compare(key, own.key) < 0) own.key = key
      return
    }
    const unit: Unit = { key, rows: [{ row, layer: stack?.layer ?? 0 }] }
    units.push(unit)
    if (stack) stacks.set(stack.id, unit)
  })
  return units.sort((a, b) => compare(a.key, b.key)).flatMap((unit) => unit.rows.sort((a, b) => a.layer - b.layer).map(({ row }) => row))
}

/** A story under way: the reviews in order, and which one is open. */
export interface Story {
  ids: readonly string[]
  at: number
}

export const startStory = (ids: readonly string[]): Story | null => (ids.length > 0 ? { ids, at: 0 } : null)

/** "3 of 14". */
export const storyPlace = ({ ids, at }: Story): string => `${at + 1} of ${ids.length}`

/** The story at its next review that is not gone, or null after the last. */
export function advanceStory(story: Story, gone: (id: string) => boolean): Story | null {
  for (let at = story.at + 1; at < story.ids.length; at++) {
    if (!gone(story.ids[at]!)) return { ...story, at }
  }
  return null
}
