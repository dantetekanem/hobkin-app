/**
 * The window's timings of a turn, for a host whose hello says `timings`: when the user sent a message, as `sentAt` on
 * `conversation.send` and `hobkin.say`, and how soon the reply's first words reached the window and showed in it, as a
 * `shown` message. Only numbers and the turn's run id travel, never words. A host from before refuses an argument it
 * does not know and closes on a message it does not know, so the window sends neither to it.
 */

/** The longest a reply's first words may take, in milliseconds, for the times to be kept. */
export const SHOWN_MAX_MS = 600_000
/** The longest run id a `shown` message may name. */
export const SHOWN_ID_MAX = 200

/** Sent once per turn the window measured. */
export interface ShownMessage {
  type: 'shown'
  /** The turn's run id, as `conversation.send` answered it. */
  id: string
  /** When the reply's first words reached the window, in milliseconds after the user sent the message. */
  arrivedMs: number
  /** When they were first on screen, one frame after the window drew them, on the same clock. */
  shownMs: number
}

export type ShownFacts = Omit<ShownMessage, 'type'>

const inRange = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= SHOWN_MAX_MS

/** The facts of a `shown` message, or null for one that is not kept. Only these three fields are taken. */
export function shownFacts(message: unknown): ShownFacts | null {
  const { id, arrivedMs, shownMs } = (message ?? {}) as Record<string, unknown>
  if (typeof id !== 'string' || !id || id.length > SHOWN_ID_MAX) return null
  if (!inRange(arrivedMs) || !inRange(shownMs) || shownMs < arrivedMs) return null
  return { id, arrivedMs, shownMs }
}
