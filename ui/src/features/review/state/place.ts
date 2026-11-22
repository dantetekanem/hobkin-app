/**
 * Where the reviewer was in a review they left for another page (spec 053): a proof, the code, any other page. Coming
 * back returns to the same step, focus, mode, history, open groups, outline, code and camera, not to step 1. A review
 * closed and opened again starts from its first step, as it always did (`startStory`), so closing forgets the place.
 *
 * Kept while the window is open, for a review at its commit (`memoryKey`), on globalThis: a hot update of this file
 * keeps the places, so a review open on screen is not sent back to its start.
 */
import type { FocusState } from '../graph/focus.ts'
import type { Camera } from '../story/camera.ts'
import type { FocusHistory } from '../story/history.ts'
import type { ReviewMode } from '../story/mode.ts'
import type { StoryState } from '../story/story.ts'

/** What a session holds of where the reviewer is (`Session.placeNow`). */
export interface SessionPlace {
  story: StoryState
  mode: ReviewMode
  history: FocusHistory
  fold: FocusState
  outline: boolean
  code: string | null
}

/** And where the camera was. */
export interface ReviewPlace extends SessionPlace {
  camera: Camera | null
}

const holder = globalThis as { __hobkinReviewPlaces?: Map<string, ReviewPlace> }
const places = (holder.__hobkinReviewPlaces ??= new Map())

/** The most places kept: the reviews left most lately. */
const KEPT = 12

export function keepPlace(key: string, place: ReviewPlace): void {
  places.delete(key)
  places.set(key, place)
  while (places.size > KEPT) places.delete(places.keys().next().value!)
}

export function placeOf(key: string): ReviewPlace | null {
  return places.get(key) ?? null
}

export function forgetPlace(key: string): void {
  places.delete(key)
}
