import type { Mood } from '../../avatar/moods.tsx'
import type { Bubble } from '../chat/bubble.ts'
import type { Reach } from '../notifications/rules.ts'
import type { SoundName } from './sounds.ts'

/**
 * When the chat's face makes a sound. Pure, so the rules are tested without a window: a new line hobkin says babbles
 * once, and a hop chirps once. Nothing plays per streamed word or for what a turn is doing, which changes all the time.
 */

/** A sound to play, as `play` takes it. */
export interface Cue {
  name: SoundName
  detail?: { word?: string }
}

/** The lines in hobkin's bubble a person reads. What its turn is doing changes all the time, so it stays quiet. */
const SAID: ReadonlySet<Bubble['kind']> = new Set(['greeting', 'tip', 'reminder'])

/** A new line in hobkin's bubble babbles once, from its first word. The same line kept on screen says nothing new. */
export function bubbleCue(before: Bubble | null, now: Bubble | null): Cue | null {
  if (!now || !SAID.has(now.kind)) return null
  if (before && before.kind === now.kind && before.text === now.text) return null
  return { name: 'talk', detail: { word: now.text.trim().split(/\s+/)[0] ?? '' } }
}

/**
 * The sound that goes with telling the user something, by how it reaches them (`Need['reach']` in
 * `notifications/rules.ts`, by the desk's levels): what cannot wait chimes, and what can wait a little nudges.
 */
export function reachCue(reach: Reach): Cue {
  return { name: reach === 'chime' ? 'chime' : 'nudge' }
}

/** The moods hobkin hops in (`hob-hop` in `avatar/hob.css`). */
const HOPS: ReadonlySet<Mood> = new Set(['happy', 'celebrating'])

/** hobkin chirps as it starts to hop: once, as its mood turns to one it hops in, and never while the face holds still. */
export function hopCue(before: Mood | null, now: Mood, still: boolean): Cue | null {
  return HOPS.has(now) && !(before && HOPS.has(before)) && !still ? { name: 'hop' } : null
}
