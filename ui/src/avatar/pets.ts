/**
 * The four pets the user picks from in Settings (spec 047). They share one body, a dome on two feet, and differ
 * only in the part on top. Measured from the user's sheet in the art's own units: the eyes sit at 84 and 116,
 * height 138, as they always have, so every mood's eyes and extras still land in place.
 */

export const PETS = ['round', 'ears', 'antenna', 'sprout'] as const

export type Pet = (typeof PETS)[number]

/** The pet hobkin wears until the user picks another. */
export const DEFAULT_PET: Pet = 'ears'

export const PET_LABEL: Record<Pet, string> = {
  round: 'Round',
  ears: 'Ears',
  antenna: 'Antenna',
  sprout: 'Sprout',
}

/** The choice that draws no character at all (No Pet). Stored as this word, after the four. */
export const NO_PET = 'none'

/** What the user can pick in Settings: one of the four pets, or none. */
export type PetChoice = Pet | typeof NO_PET

export const PET_CHOICES: readonly PetChoice[] = [...PETS, NO_PET]

export const PET_CHOICE_LABEL: Record<PetChoice, string> = { ...PET_LABEL, none: 'No Pet' }

export function isPet(value: unknown): value is Pet {
  return typeof value === 'string' && (PETS as readonly string[]).includes(value)
}

/** A stored choice (a pet or No Pet), or Ears when what was stored is neither. */
export function petOr(value: unknown): PetChoice {
  return value === NO_PET || isPet(value) ? value : DEFAULT_PET
}

/** The pet to draw where a character is needed whatever the choice (the setup story): No Pet draws Ears. */
export function characterPet(choice: PetChoice): Pet {
  return choice === NO_PET ? DEFAULT_PET : choice
}

/**
 * What a Hob draws. Where the pet is only decoration, No Pet draws nothing. A small face that tells agents apart by
 * color (it is given a tint) becomes a dot in that color. A pet asked for by name is drawn as asked, and No Pet asked
 * for by name is the empty outline the Settings tile previews.
 */
export function drawingOf({ choice, pet, tint }: { choice: PetChoice; pet?: PetChoice; tint?: string }): 'pet' | 'dot' | 'nothing' | 'outline' {
  if (pet === NO_PET) return 'outline'
  if (pet || choice !== NO_PET) return 'pet'
  return tint ? 'dot' : 'nothing'
}

/** The body every pet shares: a dome from 34 to 166 across, its top at 70, standing at 188. */
export const BODY_PATH = 'M34 182 C34 120 60 70 100 70 C140 70 166 120 166 182 Q166 188 160 188 L40 188 Q34 188 34 182 Z'

/** The two feet under the body. Their bottoms, at 197.5, are where the pet stands. */
export const FEET = [
  { cx: 74, cy: 190, rx: 14.5, ry: 7.5 },
  { cx: 126, cy: 190, rx: 14.5, ry: 7.5 },
] as const

/** Where the art reaches, in its units: the feet's bottom, and the top of the tallest part (the bulb and the leaf). */
export const PET_FOOT_Y = 197.5
export const PET_TOP_Y = 28

/** The top of each pet at rest, in the art's units: what a speech bubble sits on. */
export const PET_TOP: Record<Pet, number> = { round: 70, ears: 37.5, antenna: 28, sprout: 28 }

/** A square box around every pet, for still marks and icons. The same box for all four, so they share a baseline. */
export const MARK_BOX = { x: 12, y: 25, size: 176 } as const

export type Paint = 'fill' | 'stroke' | 'eye'

export interface PartShape {
  /** Class the moods move it by (hob.css). */
  name: string
  d: string
  paint: Paint
  strokeWidth?: number
}

/**
 * Each pet's part. Drawn behind the body: every shape reaches below the body's edge, so it can turn about its base
 * without opening a gap. The pivots in hob.css are these bases.
 */
export const PET_PARTS: Record<Pet, readonly PartShape[]> = {
  round: [],
  ears: [
    { name: 'hob-ear hob-ear-l', paint: 'fill', d: 'M92 78 C88 60 74 42 64 39 Q58 37.5 56 43 C49 58 46 80 53 102 L66 112 L98 88 Z' },
    { name: 'hob-ear hob-ear-r', paint: 'fill', d: 'M108 78 C112 60 126 42 136 39 Q142 37.5 144 43 C151 58 154 80 147 102 L134 112 L102 88 Z' },
  ],
  antenna: [
    { name: 'hob-stalk', paint: 'stroke', strokeWidth: 4.5, d: 'M100.5 84 V63 Q100.5 50 110 40' },
    { name: 'hob-bulb', paint: 'eye', d: 'M107 36 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 Z' },
  ],
  sprout: [
    { name: 'hob-stem', paint: 'stroke', strokeWidth: 4, d: 'M100 84 V51' },
    { name: 'hob-leaf hob-leaf-r', paint: 'fill', d: 'M101 52 C100 40 108 31 124.5 28 C124 40 116 50 101 52 Z' },
    { name: 'hob-leaf hob-leaf-l', paint: 'fill', d: 'M100 60 C88 61 77 52 75 38.5 C86 40 96 46 100 52 Z' },
  ],
}
