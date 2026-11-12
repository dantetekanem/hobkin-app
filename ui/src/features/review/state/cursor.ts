/**
 * Where hobkin moves the reviewer's view (`review.show`): a step, by its number from 1, or a node. The window shows each
 * place once, whether the review was on screen when hobkin pointed or is opened afterwards, from Work, Home, a report or
 * the chat. A place already shown is not shown again, so opening the review later keeps the reviewer's own walk.
 */
import type { ReviewCursor } from '#shared/review/status.ts'
import type { SessionStore } from './session.ts'

/** The newest place shown in each review, by the time hobkin pointed there. */
export interface ShownPlaces {
  shown(review: string): number
  mark(review: string, at: number): void
}

/** Storage that can hold a few words. Null keeps the places for this window only. */
interface PlaceStorage {
  getItem(name: string): string | null
  setItem(name: string, value: string): void
}

const STORAGE_NAME = 'hobkin-client-review-shown'

/** The places shown so far, kept in storage so a reload does not go back to an old one. */
export function shownPlaces(storage: PlaceStorage | null): ShownPlaces {
  let places: Record<string, number> = {}
  try {
    const saved: unknown = JSON.parse(storage?.getItem(STORAGE_NAME) ?? '{}')
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) places = saved as Record<string, number>
  } catch {
    // Unreadable: every place hobkin points to from now on is still shown once.
  }
  return {
    shown: (review) => {
      const at = places[review]
      return typeof at === 'number' && Number.isFinite(at) ? at : 0
    },
    mark: (review, at) => {
      places = { ...places, [review]: at }
      try {
        storage?.setItem(STORAGE_NAME, JSON.stringify(places))
      } catch {
        // Kept for this window only.
      }
    },
  }
}

/** Takes the reviewer to a step or a node, and frames it even when they are on it already. False when the review has none such. */
export function showPlace(session: SessionStore, place: { step?: number; node?: string }): boolean {
  const before = session.getState()
  if (place.step != null) {
    const total = before.view.story.length
    if (!Number.isInteger(place.step) || place.step < 1 || total === 0) return false
    before.goTo(Math.min(place.step, total) - 1)
  } else if (place.node != null && before.nodeOf.has(place.node)) {
    before.focusOn(place.node)
  } else {
    return false
  }
  // Already there, with the camera perhaps panned away: it frames the place again.
  if (session.getState().move.key === before.move.key) session.getState().refit()
  return true
}

/** Goes where hobkin last pointed in this review, when the window has not shown it yet. True when the view moved. */
export function followCursor(session: SessionStore, places: ShownPlaces, review: string, cursor: ReviewCursor | null | undefined): boolean {
  if (!cursor || cursor.at <= places.shown(review)) return false
  places.mark(review, cursor.at)
  return showPlace(session, cursor)
}
