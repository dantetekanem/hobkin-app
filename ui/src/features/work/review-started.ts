/**
 * Word, inside this window, that a review was just started: opened and prepared, built again, or reviewed now. Every
 * card that shows that review asks the host how it stands at once, instead of on its next turn, so it says it is
 * reviewing as the review starts. Nothing is asked of the host here, and a card that shows another review hears nothing.
 */

type Heard = () => void

/** One set of listeners for the window's life, kept across hot updates so a card that subscribed is still heard. */
const SLOT = Symbol.for('hobkin.review-started')
const listeners: Map<string, Set<Heard>> = ((globalThis as Record<symbol, unknown>)[SLOT] as Map<string, Set<Heard>> | undefined) ?? new Map()
;(globalThis as Record<symbol, unknown>)[SLOT] = listeners

/** Says review `id` was just started. */
export function reviewStarted(id: string): void {
  for (const heard of [...(listeners.get(id) ?? [])]) heard()
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
