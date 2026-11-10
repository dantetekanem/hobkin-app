import type { MoodReaction } from '#shared/protocol/snapshot.ts'
import type { Mood } from '../../avatar/moods.tsx'

/** A turn longer than this shows as focused instead of thinking, as in hobkin. */
const LONG_TURN_MS = 5 * 60000

export interface MoodInput {
  /** hobkin's reaction to the last thing that happened. It lasts until `until`. */
  reaction: MoodReaction | null | undefined
  /** The main turn is running. */
  busy: boolean
  /** Some agent or routine is running. */
  running: boolean
  /** The message input holds text. */
  typing: boolean
  /** A question is on screen. */
  asked: boolean
  /** Something waits on the user. */
  waiting: boolean
  searching: boolean
  tooling: boolean
  /** How long the turn has been running. */
  busyMs: number
  now: number
}

/**
 * The mood the avatar shows. hobkin's snapshot carries only its reaction to the last moment. What the face
 * shows between reactions depends on what is going on, and this is hobkin's own rule for it (`shownMood` in
 * `src/cli/mood.mjs`), so the avatar and the terminal face agree. `lasting` is sleep: it holds until the user wakes it.
 */
export function shownMood({ reaction, busy, running, typing, asked, waiting, searching, tooling, busyMs, now }: MoodInput): { mood: Mood; lasting: boolean } {
  const steady = (mood: Mood) => ({ mood, lasting: false })
  if (asked) return steady('listening')

  // A happy or listening face steps aside for work. Bad news and what the user said stay in sight.
  const stepsAside = reaction?.yields && (busy || running)
  if (reaction && now < reaction.until && !stepsAside) return { mood: reaction.mood as Mood, lasting: reaction.lasting === true }

  if (busy && searching) return steady('searching')
  if (busy && tooling) return steady('working')
  if (busy) return steady(busyMs >= LONG_TURN_MS ? 'focused' : 'thinking')
  if (typing) return steady('listening')
  if (running) return steady('working')
  return steady(waiting ? 'listening' : 'idle')
}
