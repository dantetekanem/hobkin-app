import { useRef, useState, type RefObject } from 'react'
import { UNFOLD } from './follow.ts'

/** A box that opens on request, and a big one further with each press. */
export interface Unfold<T extends HTMLElement> {
  open: boolean
  /** How many times it was pressed open: none while it is closed. */
  presses: number
  toggle: () => void
  more: () => void
  /** The box itself, which tells the transcript it is about to change height. */
  box: RefObject<T | null>
}

/**
 * A box the user opens and closes again, and a big one opens further with each press (`presses`, none while closed).
 * It takes its new height at once: nothing in the transcript animates its size. The transcript is told first, so
 * opening a box by the newest step never scrolls away from it.
 */
export function useUnfold<T extends HTMLElement>(): Unfold<T> {
  const [presses, setPresses] = useState(0)
  const open = presses > 0
  const box = useRef<T>(null)
  const press = (next: number) => {
    box.current?.dispatchEvent(new CustomEvent(UNFOLD, { bubbles: true, detail: { closing: next === 0 } }))
    setPresses(next)
  }
  return {
    open,
    presses,
    toggle: () => press(open ? 0 : 1),
    more: () => press(presses + 1),
    box,
  }
}
