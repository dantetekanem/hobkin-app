import { useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * When a face moves (2026-11-23, the user: "Move on change"). A face and its crab play their mood's motion when the
 * mood changes and then rest. hob.css and crab.css give each animation the whole number of plays that comes closest to
 * two seconds, and hold its last frame, so a play ends at the end of a loop and nothing jumps. A face that mounts
 * already in a mood rests in that frame without playing.
 */

/** What a face reads and sets of one of the page's animations: `Animation` in the page, a stand-in in a test. */
export interface Play {
  /** The keyframes' name of a CSS animation. A transition or a script animation (a blink) has none. */
  readonly animationName?: string
  readonly playState: string
  currentTime: CSSNumberish | null
  finish(): void
}

/** The pair's greeting plays once by its own rule (Pals.tsx), whatever the mood does. */
const OWN_RULE: ReadonlySet<string> = new Set(['hob-crab-greet', 'hob-crab-bump'])

/**
 * Settles a face's CSS animations after it draws. On mount each one is over at once. After a mood change each one
 * starts from its beginning: the ones the new mood brings do so by themselves, and one the face ran or still runs is
 * started again, since the same keyframes on the same box are kept from one mood to the next.
 */
export function settlePlays(animations: Iterable<Play>, moodChanged: boolean): void {
  for (const animation of animations) {
    const name = animation.animationName
    if (name === undefined || OWN_RULE.has(name)) continue
    try {
      if (!moodChanged) animation.finish()
      else if (animation.currentTime !== 0) animation.currentTime = 0
    } catch {
      // An animation with no end cannot be finished. It is left as it is.
    }
  }
}

/** Rests the face drawn in `root` when it mounts, and plays its motion from the start each time `mood` changes. */
export function useMoodPlay(root: RefObject<HTMLElement | null>, mood: string): void {
  const drawn = useRef(mood)
  useLayoutEffect(() => {
    const moodChanged = drawn.current !== mood
    drawn.current = mood
    const face = root.current
    if (face && typeof face.getAnimations === 'function') settlePlays(face.getAnimations({ subtree: true }), moodChanged)
  }, [root, mood])
}
