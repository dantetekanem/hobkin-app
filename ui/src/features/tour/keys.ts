/**
 * The tour's keys, as a function with no knowledge of the page. While the tour is open it owns the keyboard:
 * Enter, Right and Space go on, Left goes back, Escape leaves. Keys held with Command, Control or Option are
 * the app's own shortcuts and are not taken. Tab keeps its usual meaning.
 */
import type { TourEvent } from './flow.ts'

export interface TourPress {
  key: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

export interface TourKeyContext {
  /** A button has the keyboard: Enter and Space press it, so they are its own. */
  pressable: boolean
}

export function resolveTourKey(press: TourPress, context: TourKeyContext = { pressable: false }): TourEvent | null {
  if (press.meta || press.ctrl || press.alt) return null
  switch (press.key) {
    case 'Enter':
    case ' ':
      return press.shift || context.pressable ? null : 'next'
    case 'ArrowRight':
      return press.shift ? null : 'next'
    case 'ArrowLeft':
      return press.shift ? null : 'back'
    case 'Escape':
      return 'end'
    default:
      return null
  }
}
