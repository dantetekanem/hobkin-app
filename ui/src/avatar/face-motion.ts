import type { Mood } from './moods.tsx'

/** Below this size, in CSS pixels of the face's box, a face's parts move less than a pixel, so it moves as a whole. */
export const SMALL_FACE_PX = 40

export interface FaceMotion {
  /** The parts move on their own (eyes, hands, ears) and the eyes blink. False draws them in the mood's pose, as Still does. */
  parts: boolean
  /** The mood whose motion the face's whole box plays, or null when the box stays put. */
  whole: Mood | null
}

/**
 * Which motion a face of this size gets in this mood (spec 052, S7). A face under 40 px holds its parts in the mood's
 * pose and plays the mood's motion on its whole box. A larger face plays it on each part. A still face holds both.
 * Either plays when the mood changes and then rests (mood-play.ts).
 */
export function faceMotion({ size, mood, still }: { size: number; mood: Mood; still: boolean }): FaceMotion {
  if (still) return { parts: false, whole: null }
  if (size >= SMALL_FACE_PX) return { parts: true, whole: null }
  return { parts: false, whole: mood }
}

/**
 * How the faces move: they loop their mood's motion, play it when the mood changes and then rest, or hold still. It
 * follows Settings' Movement (`<html data-motion>`, features/settings/store.ts) and whether the Mac asks for less motion.
 */
export type FaceMovement = 'loops' | 'plays on change' | 'still'

/**
 * Lively keeps every face looping its mood's motion, as the faces did before they moved on change (2026-11-24, the
 * user: "why hobkin is not animated if lively is on?"), even when the Mac asks for less. Follow the Mac plays it when the
 * mood changes, the light default (spec 052), unless the Mac asks for less. Still never moves. `motion` is null before
 * Settings marks the page, which moves as Follow the Mac does.
 */
export function faceMovement(motion: string | null, reducedMotion: boolean): FaceMovement {
  if (motion === 'lively') return 'loops'
  if (motion === 'still' || reducedMotion) return 'still'
  return 'plays on change'
}
