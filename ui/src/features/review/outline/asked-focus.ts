import { useLayoutEffect, useRef } from 'react'

/**
 * Puts the keyboard in a field each time it is asked for, counted by `asked`, the ask that mounted the component too. A
 * part drawn only while it is open, as the outline's body is, is mounted by the very press that opens it: remembering
 * whether it was open before, it would never take the keyboard, and the letters typed next would reach the review's keys
 * (A approves, M merges). Mounted with no ask, it leaves the keyboard where it is.
 */
export function useAskedFocus(asked: number, field: () => { focus(options?: FocusOptions): void } | null): void {
  const handled = useRef(0)
  useLayoutEffect(() => {
    if (asked <= handled.current) return
    handled.current = asked
    field()?.focus({ preventScroll: true })
  })
}
