import { useRef, useState } from 'react'
import { UNFOLD } from './follow.ts'

/**
 * A box the user opens and closes again, and a big one opens further with each press (`presses`, none while closed).
 * It takes its new height at once: nothing in the transcript animates its size. The transcript is told first, so
 * opening a box by the newest step never scrolls away from it.
 */
export function useUnfold<T extends HTMLElement>() {
  const [presses, setPresses] = useState(0)
  const open = presses > 0
  const box = useRef<T>(null)
  const press = (next: number) => {
    box.current?.dispatchEvent(new CustomEvent(UNFOLD, { bubbles: true, detail: { closing: next === 0 } }))
    setPresses(next)
  }
  return { open, presses, toggle: () => press(open ? 0 : 1), more: () => press(presses + 1), box }
}
