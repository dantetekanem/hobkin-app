/**
 * The size of the setup's character, shared by the land it walks on and the layer that moves it.
 * See _specs/025-onboarding.
 */
import { PET_FOOT_Y } from '../../avatar/pets.ts'

/** The character is drawn this big, in CSS pixels, and scaled down where it sits smaller, so it stays sharp. */
export const FACE = 176

/** Where the feet end below the middle of its square, as a share of the square: the pets stand at 197.5 of -28 to 228. */
export const PET_FOOT = (PET_FOOT_Y - 100) / 256

/** A place the character sits: its middle, in window pixels, and its size as a share of `FACE`. */
export interface Seat {
  x: number
  y: number
  scale: number
}

export interface Viewport {
  width: number
  height: number
}

/** How far below its middle the character's foot is, at a scale. A seat's `y` plus this is the ground it stands on. */
export const footBelow = (scale: number): number => FACE * scale * PET_FOOT
