import type { Mood } from './moods.tsx'

/** Below this size, in CSS pixels of the face's box, a face's parts move less than a pixel, so it moves as a whole. */
export const SMALL_FACE_PX = 40

export interface FaceMotion {
  /** The parts loop on their own (eyes, hands, ears). False draws them in the mood's pose, as Still does. */
  parts: boolean
  /** The mood whose loop the face's whole box runs, or null when the box stays put. */
  whole: Mood | null
}

/**
 * Which motion a face of this size gets in this mood (spec 052, S7). A face under 40 px holds its parts in the mood's
 * pose and moves its whole box in the mood's loop. A larger face keeps every loop of its mood. A still face holds both.
 */
export function faceMotion({ size, mood, still }: { size: number; mood: Mood; still: boolean }): FaceMotion {
  if (still) return { parts: false, whole: null }
  if (size >= SMALL_FACE_PX) return { parts: true, whole: null }
  return { parts: false, whole: mood }
}
