import { useLayoutEffect, useRef, type RefObject } from 'react'
import { faceMovement, type FaceMovement } from './face-motion.ts'

/**
 * When a face moves (2026-11-23, the user: "Move on change"). A face and its crab play their mood's motion when the
 * mood changes and then rest. hob.css and crab.css give each animation the whole number of plays that comes closest to
 * two seconds, and hold its last frame, so a play ends at the end of a loop and nothing jumps. A face that mounts
 * already in a mood rests in that frame without playing, and so does one that flips between moods at work (AT_WORK).
 * Under Lively the faces loop instead (face-motion.ts, faceMovement), and none of this applies.
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
 * The moods of an agent at work. Its mood follows its last step (lib/host/frame.ts, doingOf), so it flips between these
 * every second or two. A flip inside the family rests in the new mood; only a change into it or out of it plays
 * (2026-11-23, the user: "when the mood changes (starts working, asks, finishes)"). The crab's moods share the names.
 */
export const AT_WORK: ReadonlySet<string> = new Set(['thinking', 'working', 'searching'])

/** Whether a face that showed `before` plays its motion as it shows `after`: a change, and not a flip at work. */
export function playsOnChange(before: string, after: string): boolean {
  if (before === after) return false
  const flipAtWork = AT_WORK.has(before) && AT_WORK.has(after)
  return !flipAtWork
}

/**
 * Settles a face's CSS animations after it draws. When it does not play (it has just mounted, or flipped moods at work)
 * each one is over at once. When it plays each one starts from its beginning: the ones the new mood brings do so by
 * themselves, and one the face ran or still runs is started again, since the same keyframes on the same box are kept
 * from one mood to the next.
 */
export function settlePlays(animations: Iterable<Play>, plays: boolean): void {
  for (const animation of animations) {
    const name = animation.animationName
    if (name === undefined || OWN_RULE.has(name)) continue
    try {
      if (!plays) animation.finish()
      else if (animation.currentTime !== 0) animation.currentTime = 0
    } catch {
      // An animation with no end cannot be finished. It is left as it is.
    }
  }
}

/** How the page the face is drawn in moves now: Settings' Movement on its root, and whether the Mac asks for less. */
function movementOf(face: HTMLElement): FaceMovement {
  const page = face.ownerDocument as Document | undefined
  const motion = page?.documentElement.getAttribute('data-motion') ?? null
  const reduced = page?.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false
  return faceMovement(motion, reduced)
}

/**
 * Rests the face drawn in `root` when it mounts, and plays its motion from the start each time `mood` changes, except
 * for a flip between moods at work, which rests in the new one. Under Lively it leaves the face's loops running as they
 * are: a mood's own loop starts by itself, and one the moods share keeps going.
 */
export function useMoodPlay(root: RefObject<HTMLElement | null>, mood: string): void {
  const drawn = useRef(mood)
  useLayoutEffect(() => {
    const plays = playsOnChange(drawn.current, mood)
    drawn.current = mood
    const face = root.current
    if (!face || typeof face.getAnimations !== 'function' || movementOf(face) === 'loops') return
    settlePlays(face.getAnimations({ subtree: true }), plays)
  }, [root, mood])
}
