import { useLayoutEffect, useRef, useState } from 'react'
import { useStill } from '@/app/still.ts'
import { ease } from '@/lib/motion.ts'

/** Sent from a box the user opens or closes, so the transcript around it holds still (use-follow.ts). */
export const UNFOLD = 'hb-unfold'
/** How long a box takes to reach its new height. */
export const UNFOLD_MS = 300

/**
 * A box the user opens to all of its lines and closes again. Its height glides from what it was to what it is (at once
 * under Still), and the transcript is told first, so opening a box by the newest step never scrolls away from it.
 */
export function useUnfold<T extends HTMLElement>() {
  const still = useStill()
  const [open, setOpen] = useState(false)
  const box = useRef<T>(null)
  const from = useRef<number | null>(null)
  useLayoutEffect(() => {
    const element = box.current
    const before = from.current
    from.current = null
    if (!element || before === null || still) return
    const after = element.offsetHeight
    if (Math.abs(after - before) < 1) return
    element.animate([{ height: `${before}px`, overflow: 'hidden' }, { height: `${after}px`, overflow: 'hidden' }], { duration: UNFOLD_MS, easing: `cubic-bezier(${ease.out.join(', ')})` })
  }, [open, still])
  const toggle = () => {
    from.current = box.current?.offsetHeight ?? null
    box.current?.dispatchEvent(new CustomEvent(UNFOLD, { bubbles: true, detail: { closing: open } }))
    setOpen(!open)
  }
  return { open, toggle, box }
}
