/**
 * Word, inside this window, that a review was just started: opened and prepared, built again, or reviewed now. Every
 * card that shows that review, and every list of reviews, asks the host how it stands at once, instead of on its next
 * turn, so it says it is reviewing as the review starts. Nothing is asked of the host here, and a card that shows
 * another review hears nothing.
 */

type Heard = () => void

/** One set of listeners for the window's life, kept across hot updates so a card that subscribed is still heard. */
const SLOT = Symbol.for('hobkin.review-started')
const listeners: Map<string, Set<Heard>> = ((globalThis as Record<symbol, unknown>)[SLOT] as Map<string, Set<Heard>> | undefined) ?? new Map()
;(globalThis as Record<symbol, unknown>)[SLOT] = listeners

/** The lists, which hear every review started. Kept across hot updates as the cards' listeners are. */
const ANY_SLOT = Symbol.for('hobkin.review-started.any')
const anyListeners: Set<Heard> = ((globalThis as Record<symbol, unknown>)[ANY_SLOT] as Set<Heard> | undefined) ?? new Set()
;(globalThis as Record<symbol, unknown>)[ANY_SLOT] = anyListeners

/** Says review `id` was just started. */
export function reviewStarted(id: string): void {
  for (const heard of [...(listeners.get(id) ?? []), ...anyListeners]) heard()
}

/** Hears each time any review is started, until the function it answers is called. */
export function onAnyReviewStarted(heard: Heard): () => void {
  anyListeners.add(heard)
  return () => {
    anyListeners.delete(heard)
  }
}

/** Hears each time review `id` is started, until the function it answers is called. */
export function onReviewStarted(id: string, heard: Heard): () => void {
  const set = listeners.get(id) ?? new Set<Heard>()
  set.add(heard)
  listeners.set(id, set)
  return () => {
    set.delete(heard)
    if (set.size === 0 && listeners.get(id) === set) listeners.delete(id)
  }
}
