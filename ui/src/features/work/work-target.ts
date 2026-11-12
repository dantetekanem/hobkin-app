import { requestCanvasFocus } from '@/app/focus.ts'
import { useView } from '@/app/view-store.ts'
import { useWorkTab } from './tab.ts'

/**
 * Opening one item on the Work screen from another screen, as an issue's chip on the GitHub page does: Work opens on
 * its own page, and the keyboard lands on the item's queue row or finished card once Work has drawn it, scrolled into
 * sight. Work takes the target once, as it arrives. One it does not show, such as a row past the five a long queue
 * shows, is let go, and Work opens as it always does.
 */

let pending: string | null = null

/** Opens the Work screen on the element `target` selects. */
export function openOnWork(target: string): void {
  pending = target
  useWorkTab.getState().choose('work')
  useView.getState().openScreen('work')
  useView.getState().engageCanvas()
  requestCanvasFocus()
}

/** Bound once by the Work screen as it arrives, before its own first stop takes the keyboard. */
export function bindWorkTarget(root: HTMLElement | null): (() => void) | undefined {
  const target = pending
  if (!target) return
  const section = root?.closest<HTMLElement>('[data-canvas-screen]')
  const element = root?.querySelector<HTMLElement>(target)
  if (!section || !element) {
    pending = null
    return
  }
  const take = (event?: FocusEvent) => {
    if (pending !== target || (event && event.target !== section)) return
    pending = null
    event?.stopImmediatePropagation()
    element.focus({ preventScroll: true })
    element.scrollIntoView({ block: 'center' })
  }
  section.addEventListener('focus', take)
  if (document.activeElement === section) take()
  return () => section.removeEventListener('focus', take)
}
