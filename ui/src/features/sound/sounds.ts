/**
 * hobkin's sounds, as data. Each is a few tones made with nothing but oscillators, which `player.ts` plays. Pure, so
 * how loud, how long and how high each one is can be tested, and tuned here in one place. Small and soft, like a little
 * creature, never a system alert.
 */

export const SOUND_NAMES = ['talk', 'hop', 'land', 'pick', 'tap', 'chime', 'cheer'] as const
export type SoundName = (typeof SOUND_NAMES)[number]

/** Sine is the softest. Triangle adds a little edge, so a quiet tone still reads on laptop speakers. */
export type Wave = 'sine' | 'triangle'

/** One tone of a sound. Times are seconds from the sound's start. */
export interface Tone {
  wave: Wave
  /** Hertz at the start. The pitch glides from here to `to` over the tone. */
  from: number
  to: number
  at: number
  /** The whole tone, from silence back to silence. */
  length: number
  /** How long it takes to rise from silence to the peak. */
  attack: number
  /** The loudest it gets, as a gain. */
  peak: number
  /**
   * A fast wobble of the pitch, the "rr" of a babbled syllable: `rate` times a second, `depth` semitones each way at
   * the start, narrowing to `settle` of that by the end so the syllable settles.
   */
  trill?: { rate: number; depth: number; settle: number }
  /** A quick fall into the pitch, the "t" a syllable starts with: from `ratio` times `from`, over `length` seconds. */
  onset?: { ratio: number; length: number }
}

/** Every tone spends its last few milliseconds ramping to true silence, so it never ends on a click. */
export const FADE_OUT = 0.004

/** A glide with no trill is drawn through a point this often, in seconds, so it curves as the ear hears pitch. */
const GLIDE_STEP = 0.015

/**
 * A tone's pitch over time, as [seconds from its start, hertz] points the player ramps between in straight lines. The
 * glide from `from` to `to` is even to the ear; a trill adds its wobble, drawn through each peak, trough and crossing.
 * The trill starts once the onset has fallen, so the fall does not eat its first rise.
 */
export function pitchCurve({ from, to, length, trill, onset }: Tone): [at: number, hz: number][] {
  const start = onset?.length ?? 0
  const hzAt = (at: number) => {
    let swing = 0
    if (trill) {
      const narrowing = 1 - (1 - trill.settle) * (at / length)
      swing = trill.depth * narrowing * Math.sin(2 * Math.PI * trill.rate * (at - start))
    }
    return from * (to / from) ** (at / length) * 2 ** (swing / 12)
  }
  const step = trill ? 1 / (4 * trill.rate) : from === to ? length : GLIDE_STEP
  const curve: [number, number][] = onset ? [[0, hzAt(start) * onset.ratio]] : []
  for (let index = 0; curve.at(-1)?.[0] !== length; index += 1) {
    const at = Math.min(length, start + index * step)
    curve.push([at, hzAt(at)])
  }
  return curve
}

const tone = (wave: Wave, from: number, to: number, at: number, length: number, peak: number, attack = 0.005): Tone => ({ wave, from, to, at, length, attack, peak })

/** The range a word babbles in: about the voice of something small. */
export const TALK_RANGE = { low: 480, high: 900 } as const

/** What counts in a word: capitals and punctuation do not change how it sounds. A word of nothing but marks keeps them. */
const lettersOf = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || word.trim()

/** A word's own number, the same every time. The last steps mix the bits, so words a letter apart land far apart. */
function wordHash(text: string): number {
  let hash = 0x811c9dc5
  for (const char of text) hash = Math.imul(hash ^ char.codePointAt(0)!, 0x01000193)
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}

/** The pitch a word babbles at, in hertz. Spread evenly to the ear across the range, so a sentence goes up and down. */
export function talkPitch(word: string): number {
  const share = wordHash(lettersOf(word)) / 2 ** 32
  return TALK_RANGE.low * (TALK_RANGE.high / TALK_RANGE.low) ** share
}

/**
 * How one babbled syllable is made, a "turum" of a game character's mumble. The numbers to tune by ear are all here.
 * Called a word at a time 45 ms apart, the syllables overlap and run together, so each one stays quiet.
 */
export const SYLLABLE = {
  /** The whole syllable, in seconds: a word of no letters, what each letter adds, and the longest. */
  shortest: 0.05,
  perLetter: 0.0065,
  longest: 0.11,
  /** The "rr": the word picks a trill rate in this range, in hertz, this many semitones each way, narrowing to this share. */
  trillRate: { low: 18, high: 26 },
  trillDepth: 1.5,
  trillSettle: 0.35,
  /** The "t": the pitch starts this much higher and falls to the word's in this many seconds, under a bright tick. */
  onsetRatio: 1.3,
  onsetLength: 0.012,
  tick: { ratio: 3, length: 0.01, peak: 0.014 },
  /** The voiced "u", a triangle, for this share of the syllable. */
  body: { share: 0.85, peak: 0.04 },
  /** The "m": a duller sine at the settled pitch, from this share of the way in to the end. */
  tail: { from: 0.4, peak: 0.025 },
  /** Where the pitch settles by the end, as a share of the word's pitch. */
  settle: 0.97,
} as const

/** One syllable of babble: a "t" tick, a trilled "u" that falls into the word's pitch, and an "m" it fades through. */
function syllable(word: string): Tone[] {
  const s = SYLLABLE
  const letters = lettersOf(word)
  const pitch = talkPitch(word)
  const settled = pitch * s.settle
  const length = Math.min(s.longest, s.shortest + [...letters].length * s.perLetter)
  const rate = s.trillRate.low + (wordHash(`${letters}~`) % (s.trillRate.high - s.trillRate.low + 1))
  return [
    tone('triangle', pitch * s.tick.ratio, pitch * s.tick.ratio, 0, s.tick.length, s.tick.peak, 0.001),
    {
      ...tone('triangle', pitch, settled, 0, length * s.body.share, s.body.peak, 0.006),
      trill: { rate, depth: s.trillDepth, settle: s.trillSettle },
      onset: { ratio: s.onsetRatio, length: s.onsetLength },
    },
    tone('sine', settled, settled * 0.98, length * s.tail.from, length * (1 - s.tail.from), s.tail.peak, length * 0.2),
  ]
}

/** A soft bell: the note, and its octave much quieter and shorter, which makes it ring like glass. */
const bell = (note: number, at: number, length: number): Tone[] => [tone('sine', note, note, at, length, 0.1, 0.004), tone('sine', note * 2, note * 2, at, length * 0.5, 0.022, 0.003)]

/** One quick note of a flourish, nudged up a little as it plays. */
const blip = (note: number, at: number, length: number): Tone => tone('triangle', note, note * 1.02, at, length, 0.09, 0.004)

const NOTE = { E5: 659.25, Gs5: 830.61, G5: 783.99, B5: 987.77, C6: 1046.5 } as const

const SOUNDS: Record<SoundName, (word: string) => Tone[]> = {
  talk: syllable,
  // A rising chirp as it leaves the ground.
  hop: () => [tone('sine', 360, 920, 0, 0.11, 0.12, 0.012)],
  // A falling thump, with a little body above it so small speakers carry it.
  land: () => [tone('sine', 200, 90, 0, 0.09, 0.16, 0.004), tone('triangle', 400, 200, 0, 0.05, 0.035, 0.003)],
  // A bright pop: a quick sweep up, and a glint an octave over it.
  pick: () => [tone('sine', 700, 1400, 0, 0.06, 0.12, 0.003), tone('sine', 1400, 2100, 0.004, 0.04, 0.03, 0.003)],
  // A small tick, quieter and shorter than a pick.
  tap: () => [tone('triangle', 1250, 1050, 0, 0.032, 0.06, 0.002)],
  // Two bells rising a fourth.
  chime: () => [...bell(NOTE.G5, 0, 0.5), ...bell(NOTE.C6, 0.14, 0.7)],
  // Three quick notes up a major chord, the last held a little.
  cheer: () => [blip(NOTE.E5, 0, 0.08), blip(NOTE.Gs5, 0.07, 0.08), blip(NOTE.B5, 0.14, 0.16)],
}

/** The tones of one sound. `word` only changes `talk`. */
export function tonesOf(name: SoundName, detail?: { word?: string }): Tone[] {
  return SOUNDS[name](detail?.word ?? '')
}

/** How long a sound runs, in seconds, from its first tone's start to its last tone's end. */
export function soundLength(tones: readonly Tone[]): number {
  return tones.reduce((longest, { at, length }) => Math.max(longest, at + length), 0)
}

/**
 * The least time between two of the same sound, in milliseconds. Notices that arrive together chime once, and a mood
 * that flickers does not chirp twice. Babble keeps up with one word every 45 ms.
 */
export const GAP_MS: Record<SoundName, number> = { talk: 30, hop: 250, land: 120, pick: 60, tap: 40, chime: 1500, cheer: 300 }

/** Whether a sound may play now, given when it last played (milliseconds on one clock). */
export function mayPlay(name: SoundName, now: number, last: number | undefined): boolean {
  return last === undefined || now - last >= GAP_MS[name]
}
