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
import type { FocusEntry } from '../story/history.ts'
import type { ReviewMode } from '../story/mode.ts'
import type { StoryState } from '../story/story.ts'
import type { ReviewLook } from './look.ts'

/** A place to go back to, with its step's id: a story rewritten at the same commit moves its steps' places. */
export type KeptEntry = FocusEntry & { stepId: string }

/**
 * What a session holds of where the reviewer is (`Session.placeNow`). The step and the places to go back to are kept by
 * their steps' ids too: the same commit can come back with its story rewritten, as when its AI review lands meanwhile.
 */
export interface SessionPlace {
  story: StoryState
  stepId: string
  mode: ReviewMode
  history: { back: KeptEntry[]; forward: KeptEntry[] }
  fold: FocusState
  outline: boolean
  code: string | null
  /** The run of the proof open beside the review. A place kept before the proof sat beside the review has none. */
  proof?: string | null
  /** Graph or Code (spec 071). A place kept before the code view has none, and comes back in the graph. */
  look?: ReviewLook
  /** The file the code view showed. */
  file?: string | null
  /** The code view was opened from the graph, so Escape goes back there. */
  fromGraph?: boolean
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

/** The camera to come back to: the place's, only when the session took the place (`Session.resumed`). */
export function resumedCamera(place: ReviewPlace | null, resumed: boolean): Camera | null {
  return resumed ? (place?.camera ?? null) : null
}
