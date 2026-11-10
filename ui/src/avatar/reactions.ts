import type { Mood } from './moods.tsx'

/**
 * What the face does when the user wakes it, pokes it or keeps passing the pointer over it.
 * Ported from hobkin's `src/cli/face-reactions.mjs`, same rules and timings, so the avatar and the
 * terminal face behave alike. Each reaction is a few of the face's own moods and ends by the clock.
 */

export interface AppReaction {
  mood: Mood
  /** A lasting reaction is sleep: it holds until the user wakes the face. */
  lasting?: boolean
}

interface Step {
  mood: Mood
  ms: number
}

// Drowsy, a stretch, then awake.
const WAKING: Step[] = [
  { mood: 'focused', ms: 1000 },
  { mood: 'happy', ms: 900 },
  { mood: 'hello', ms: 1100 },
]
// Startled, then amused, then annoyed, while each poke comes soon after the last.
const POKED: Mood[] = ['surprised', 'wink', 'happy', 'grumpy']
const POKE_MS = 1400
const POKE_STREAK_MS = 2500
const RUBBED: Step[] = [{ mood: 'dizzy', ms: 2400 }]
const RUB_PASSES = 5
const RUB_WINDOW_MS = 4000
// After a rub the face takes no notice for a while, so moving the pointer about cannot keep it dizzy.
const RUB_PAUSE_MS = 30000

export interface FaceReactionsOptions {
  now?: () => number
  reaction?: () => AppReaction | null
  onWake?: () => void
}

export class FaceReactions {
  private playing: { steps: Step[]; waking: boolean; since: number } | null = null
  private wokeFrom: AppReaction | null = null
  private pokeStreak = 0
  private lastPokeAt = -Infinity
  private passTimes: number[] = []
  private pointerOnFace = false
  private rubbedAt = -Infinity
  private readonly now: () => number
  private readonly appReaction: () => AppReaction | null
  private readonly onWake: () => void

  constructor({ now = Date.now, reaction = () => null, onWake = () => {} }: FaceReactionsOptions = {}) {
    this.now = now
    this.appReaction = reaction
    this.onWake = onWake
  }

  /** The app's reaction as the face takes it: the sleep it woke from is over before the app hears so. */
  current(): AppReaction | null {
    const reaction = this.appReaction()
    return reaction && reaction === this.wokeFrom ? null : reaction
  }

  asleep(): boolean {
    return Boolean(this.current()?.lasting)
  }

  waking(): boolean {
    return Boolean(this.playing?.waking && this.shown())
  }

  /** Plays the waking up and tells the app the sleep is over. True when there was a sleep to end. */
  wake(): boolean {
    if (!this.asleep()) return false

    this.wokeFrom = this.appReaction()
    this.play(WAKING, true)
    this.onWake()
    return true
  }

  /** Wakes a sleeping face, and otherwise pokes it. A poke also restarts the passes, so poking and rubbing stay apart. */
  click(): void {
    if (this.wake() || this.waking()) return

    const at = this.now()
    const onStreak = at - this.lastPokeAt < POKE_STREAK_MS
    this.pokeStreak = onStreak ? this.pokeStreak + 1 : 1
    this.lastPokeAt = at
    this.passTimes = []

    const mood = POKED[Math.min(this.pokeStreak, POKED.length) - 1]!
    this.play([{ mood, ms: POKE_MS }])
  }

  /** Counts each time the pointer comes onto the face. True when that starts a reaction. A face asleep, reacting or rubbed lately takes no notice. */
  hover(inside: boolean): boolean {
    const entered = inside && !this.pointerOnFace
    this.pointerOnFace = inside
    if (!entered || this.asleep() || this.shown()) return false

    const at = this.now()
    if (at - this.rubbedAt < RUB_PAUSE_MS) return false
    const recent = this.passTimes.filter((passedAt) => at - passedAt < RUB_WINDOW_MS)
    this.passTimes = [...recent, at]
    if (this.passTimes.length < RUB_PASSES) return false

    this.passTimes = []
    this.rubbedAt = at
    this.play(RUBBED)
    return true
  }

  private play(steps: Step[], waking = false): void {
    this.playing = { steps, waking, since: this.now() }
  }

  /** The mood to draw in place of the usual one, and how long until it ends. Null when nothing is playing. */
  shown(at: number = this.now()): { mood: Mood; endsIn: number } | null {
    if (!this.playing) return null

    let start = this.playing.since
    for (const { mood, ms } of this.playing.steps) {
      if (at < start + ms) return { mood, endsIn: start + ms - at }
      start += ms
    }
    return null
  }
}
