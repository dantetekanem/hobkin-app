import type { Mood } from './moods.tsx'

/**
 * hobkin's crab pal: the little crab that stands beside hobkin's face for a run on Claude Code (Pals.tsx). Pure, so
 * which runs get one and how it feels are tested without a window.
 */

/** The crab's moods. Fewer than hobkin's: each is one way it stands and moves (Crab.tsx, crab.css). */
export const CRAB_MOODS = ['idle', 'working', 'thinking', 'searching', 'listening', 'happy', 'surprised', 'sad', 'dizzy', 'sleepy'] as const

export type CrabMood = (typeof CRAB_MOODS)[number]

/** How the crab takes each of hobkin's moods: it works when hobkin works, cheers when hobkin cheers, and leans in to listen. */
const CRAB_MOOD: Record<Mood, CrabMood> = {
  idle: 'idle',
  hello: 'happy',
  listening: 'listening',
  thinking: 'thinking',
  searching: 'searching',
  working: 'working',
  focused: 'working',
  happy: 'happy',
  celebrating: 'happy',
  love: 'happy',
  wink: 'happy',
  surprised: 'surprised',
  // hobkin looks puzzled when it waits for the user: the crab leans in beside it.
  confused: 'listening',
  sad: 'sad',
  grumpy: 'sad',
  error: 'sad',
  dizzy: 'dizzy',
  sleepy: 'sleepy',
}

export function crabMoodOf(mood: Mood): CrabMood {
  return CRAB_MOOD[mood]
}

/** How long the pair rests before both fall asleep. */
export const SLEEP_AFTER_MS = 10 * 60_000

/** The pair has rested since `since` (milliseconds since the epoch) long enough to fall asleep at `now`. */
export function restedLong(since: number | undefined, now: number): boolean {
  return since !== undefined && Number.isFinite(since) && now - since >= SLEEP_AFTER_MS
}

export interface PalsInput {
  /** The face's mood, as the page would give hobkin's face alone. */
  mood: Mood
  /** The run waits for the user. */
  asking?: boolean
  /** False: the run rests (it waits for its next turn, or it ended), and both hold their pose. */
  working?: boolean
  /** The run ended well. */
  endedWell?: boolean
  /** The pair has rested long (`restedLong`). */
  restedLong?: boolean
}

export interface PalsState {
  /** The mood hobkin's face shows. */
  face: Mood
  crab: CrabMood
  /** The crab plays its mood's motion when the mood changes. False holds its pose. */
  moving: boolean
}

/**
 * What the pair shows. Both cheer when a run ends well, and both sleep once they have rested long. While the run waits,
 * for the user or for its next turn, the crab leans in toward hobkin. Otherwise the crab takes hobkin's mood.
 */
export function palsState({ mood, asking = false, working = true, endedWell = false, restedLong = false }: PalsInput): PalsState {
  if (endedWell) return { face: 'happy', crab: 'happy', moving: false }
  if (!working && restedLong) return { face: 'sleepy', crab: 'sleepy', moving: false }
  if (asking || !working) return { face: mood, crab: 'listening', moving: working }
  return { face: mood, crab: crabMoodOf(mood), moving: true }
}
