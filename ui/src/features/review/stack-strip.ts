import type { FinishedChange } from '#shared/protocol/work.ts'
import { reviewIdOf } from '#shared/review/ids.ts'

/**
 * The stack a review is a layer of (_specs/060-make-it-a-stack, "A stack once it exists"), read from the finished
 * changes the window holds. Pure, so it is tested without a window.
 */

export interface StripLayer {
  /** Counted from the bottom, which is 1 and lands next. */
  number: number
  title: string
  /** The change's key, `slug:item`. */
  key: string
  slug: string
  item: string
  /** The review that shows this layer alone. */
  reviewId: string
  open: boolean
}

export interface StackStrip {
  /** The stack, named by its bottom layer's item. */
  id: string
  /** How many layers have not landed. A layer that is not among the changes is a gap in `slots`. */
  of: number
  /** The layer this review shows. */
  at: number
  /** One place for each layer from the bottom: the layer, or null when this window does not hold it. */
  slots: (StripLayer | null)[]
  /** The nearest layer under the open one, and the nearest over it. Null at the bottom and at the top. */
  under: StripLayer | null
  over: StripLayer | null
  /** What this review shows, in one line. */
  line: string
}

/** The review a finished change opens: its own id, or the sample's one review when there is no host. */
export const layerReviewId = (change: { slug: string; item: string }): string => reviewIdOf({ kind: 'change', slug: change.slug, item: change.item })

/** The line under the strip. A layer's review is of that layer alone, on top of the one under it. */
export function stripLine(at: number): string {
  return at <= 1 ? 'The bottom layer, on top of the default branch.' : `This layer alone, on top of layer ${at - 1}.`
}

/** The key of the finished change a review shows, or null when it is not one of them. */
export function openKeyOf(changes: readonly FinishedChange[], reviewId: string): string | null {
  return changes.find((change) => layerReviewId(change) === reviewId)?.key ?? null
}

/** The stack the change with `openKey` is a layer of, or null when it is in none or is not among `changes`. */
export function stackStrip(changes: readonly FinishedChange[], openKey: string | null): StackStrip | null {
  const open = changes.find((change) => change.key === openKey)
  const place = open?.stack
  if (!open || !place) return null

  const slots: (StripLayer | null)[] = Array.from({ length: Math.max(place.of, place.layer) }, () => null)
  for (const change of changes) {
    if (change.stack?.id !== place.id) continue
    const index = change.stack.layer - 1
    if (index < 0 || index >= slots.length) continue
    slots[index] = { number: change.stack.layer, title: change.title, key: change.key, slug: change.slug, item: change.item, reviewId: layerReviewId(change), open: change.key === open.key }
  }
  const present = slots.filter((slot): slot is StripLayer => slot !== null)
  return {
    id: place.id,
    of: slots.length,
    at: place.layer,
    slots,
    under: present.findLast((slot) => slot.number < place.layer) ?? null,
    over: present.find((slot) => slot.number > place.layer) ?? null,
    line: stripLine(place.layer),
  }
}
